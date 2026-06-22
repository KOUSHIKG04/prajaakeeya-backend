import { Column, Entity, OneToMany } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { User } from "../users/user.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { Vote } from "../votes/vote.entity";

@Entity("wards")
export class Ward extends BaseEntity {
  @Column({ unique: true })
  number!: string;

  @Column()
  name!: string;

  @Column({ nullable: true, default: "N/A" })
  state!: string;

  @Column({ nullable: true, default: "N/A" })
  parliamentary!: string;

  @Column({ nullable: true, default: "N/A" })
  assembly!: string;

  @Column({ default: "N/A" })
  zone!: string;

  @Column({ nullable: true })
  category?: string;

  @Column({ default: "Greater Bengaluru Authority(GBA) – Bengaluru" })
  municipality!: string;

  @OneToMany(() => User, (user) => user.ward)
  users?: User[];

  @OneToMany(() => Aspirant, (aspirant) => aspirant.ward)
  aspirants?: Aspirant[];

  @OneToMany(() => Vote, (vote) => vote.ward)
  votes?: Vote[];
}
