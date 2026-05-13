import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Notification, NotificationType } from "./notification.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { AspirantMeeting } from "../aspirants/aspirant-meeting.entity";
import { AspirantVisit } from "../aspirants/aspirant-visit.entity";
import { ElectionType } from "../elections/election.entity";

interface ConstituencyContext {
  electionType: ElectionType;
  constituencyName: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async list(
    userId: number,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const qb = this.repo
      .createQueryBuilder("n")
      .where("n.userId = :userId", { userId })
      .orderBy("n.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);
    if (options.unreadOnly) {
      qb.andWhere("n.isRead = :isRead", { isRead: false });
    }
    const [data, total] = await qb.getManyAndCount();
    const unreadCount = await this.unreadCount(userId);
    return {
      data,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  unreadCount(userId: number): Promise<number> {
    return this.repo.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: number, id: number) {
    const notification = await this.repo.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException("Notification not found");
    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await this.repo.save(notification);
    }
    return notification;
  }

  async markAllRead(userId: number) {
    const res = await this.repo
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where("user_id = :userId AND is_read = false", { userId })
      .execute();
    return { updated: res.affected ?? 0 };
  }

  async deleteOne(userId: number, id: number) {
    const notification = await this.repo.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException("Notification not found");
    await this.repo.delete(id);
    return { deleted: 1 };
  }

  /**
   * Find every user whose saved constituency matches the aspirant's
   * election type + constituency. Excludes the aspirant's own userId so
   * the aspirant doesn't receive their own event notifications.
   */
  private async findRecipientUserIds(
    electionType: ElectionType,
    constituencyId: number,
    excludeUserId?: number,
  ): Promise<number[]> {
    const column = ({
      lok_sabha: "lok_sabha_constituency_id",
      state_assembly: "state_assembly_constituency_id",
      municipal_corporation: "municipal_corporation_constituency_id",
      gram_panchayat: "gram_panchayat_constituency_id",
    } as Record<ElectionType, string>)[electionType];
    if (!column) return [];

    const qb = this.repo.manager
      .createQueryBuilder()
      .select("u.id", "id")
      .from("users", "u")
      .where(`u.${column} = :constituencyId`, { constituencyId })
      .andWhere("u.is_blocked = false")
      .andWhere("u.is_self_deleted = false");
    if (excludeUserId) {
      qb.andWhere("u.id != :excludeUserId", { excludeUserId });
    }
    const rows = await qb.getRawMany();
    return rows.map((r) => Number(r.id));
  }

  /** Bulk-insert notification rows in chunks. */
  private async fanOut(
    userIds: number[],
    template: Omit<Partial<Notification>, "userId">,
  ) {
    if (!userIds.length) return { created: 0 };
    const CHUNK = 500;
    let created = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const slice = userIds.slice(i, i + CHUNK);
      const rows = slice.map((userId) => this.repo.create({ ...template, userId }));
      await this.repo.save(rows);
      created += rows.length;
    }
    return { created };
  }

  /**
   * Notify all users in the aspirant's constituency that a new aspirant
   * has registered. Best-effort: failures are logged but don't break the
   * registration flow.
   */
  async notifyNewAspirant(aspirant: Aspirant, context: ConstituencyContext) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      const constituencySuffix = context.constituencyName
        ? ` in ${context.constituencyName}`
        : "";
      return this.fanOut(recipients, {
        type: "new_aspirant",
        title: "New aspirant registered",
        body: `${aspirant.name} has registered as an aspirant${constituencySuffix}.`,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
      });
    } catch (err) {
      this.logger.error(
        `notifyNewAspirant failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  /**
   * Notify users in the aspirant's constituency about a scheduled
   * meeting. `meeting` may be from one of several persistence flows
   * (single, bulk, ward); only the fields we use are required.
   */
  async notifyAspirantMeeting(
    aspirant: Aspirant,
    meeting: AspirantMeeting | { id?: number; title?: string; startTime?: number },
    context: ConstituencyContext,
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      const meetingTitle = meeting.title || "a new meeting";
      const constituencySuffix = context.constituencyName
        ? ` (${context.constituencyName})`
        : "";
      return this.fanOut(recipients, {
        type: "aspirant_meeting",
        title: `${aspirant.name} scheduled a meeting`,
        body: `${aspirant.name}${constituencySuffix} scheduled "${meetingTitle}".`,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        meetingId: meeting.id ?? null,
        metadata: meeting.startTime ? { startTime: meeting.startTime } : null,
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantMeeting failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  async notifyAspirantVisit(
    aspirant: Aspirant,
    visit: AspirantVisit,
    context: ConstituencyContext,
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      const visitTitle = visit.title || "a ward visit";
      const locationSuffix = visit.location ? ` at ${visit.location}` : "";
      return this.fanOut(recipients, {
        type: "aspirant_visit",
        title: `${aspirant.name} planned a visit`,
        body: `${aspirant.name} planned "${visitTitle}"${locationSuffix}.`,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        visitId: visit.id ?? null,
        metadata: {
          startTime: visit.startTime ?? null,
          location: visit.location ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantVisit failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  /**
   * Generic event notification — for anything beyond meetings/visits
   * (e.g. manifesto update, profile changes, ad-hoc announcements).
   */
  async notifyAspirantEvent(
    aspirant: Aspirant,
    context: ConstituencyContext,
    event: { title: string; body: string; metadata?: Record<string, any> },
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      return this.fanOut(recipients, {
        type: "aspirant_event",
        title: event.title,
        body: event.body,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        metadata: event.metadata ?? null,
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantEvent failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }
}
