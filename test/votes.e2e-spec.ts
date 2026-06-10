import request = require("supertest");
import { BadRequestException, INestApplication } from "@nestjs/common";
import { VotesController } from "../src/votes/votes.controller";
import { VotesService } from "../src/votes/votes.service";
import { createE2EApp, signToken } from "./utils/e2e";

/**
 * HTTP e2e for VotesController — real JwtAuthGuard + ValidationPipe; VotesService
 * mocked (no DB). Also verifies a service exception maps to the right HTTP code.
 */
describe("VotesController (e2e, no DB)", () => {
  let app: INestApplication;

  const votesService = {
    castVote: jest.fn(async () => ({ id: 1, aspirantId: 5 })),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      controllers: [VotesController],
      providers: [{ provide: VotesService, useValue: votesService }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("rejects with 401 when no token is sent", () =>
    request(app.getHttpServer())
      .post("/api/vote")
      .send({ aspirantId: 5 })
      .expect(401));

  it("rejects with 400 when aspirantId is missing", () =>
    request(app.getHttpServer())
      .post("/api/vote")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({})
      .expect(400));

  it("rejects with 400 when aspirantId is not an integer", () =>
    request(app.getHttpServer())
      .post("/api/vote")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ aspirantId: 1.5 })
      .expect(400));

  it("casts the vote (201) forwarding the authed user id and dto", async () => {
    await request(app.getHttpServer())
      .post("/api/vote")
      .set("Authorization", `Bearer ${signToken({ sub: 42 })}`)
      .send({ aspirantId: 5 })
      .expect(201);

    expect(votesService.castVote).toHaveBeenCalledWith(42, { aspirantId: 5 });
  });

  it("maps a service BadRequestException to HTTP 400", async () => {
    votesService.castVote.mockRejectedValueOnce(
      new BadRequestException("You have already voted"),
    );

    const res = await request(app.getHttpServer())
      .post("/api/vote")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ aspirantId: 5 })
      .expect(400);

    expect(res.body.message).toContain("already voted");
  });
});
