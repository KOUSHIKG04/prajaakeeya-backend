import request = require("supertest");
import {
  BadRequestException,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";
import { AspirantsController } from "../src/aspirants/aspirants.controller";
import { AspirantsService } from "../src/aspirants/aspirants.service";
import { createE2EApp, signToken } from "./utils/e2e";

/**
 * HTTP e2e for AspirantsController — covers a public route, a guarded+validated
 * rating route, and service exception → HTTP mapping. AspirantsService mocked,
 * so no DB runs.
 */
describe("AspirantsController (e2e, no DB)", () => {
  let app: INestApplication;

  const aspirantsService = {
    findByConstituency: jest.fn(async () => [{ id: 54, name: "Acchu M" }]),
    rateVisit: jest.fn(async () => ({ id: 1, rating: 4 })),
    rateContact: jest.fn(async () => ({ id: 2, rating: 5 })),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      controllers: [AspirantsController],
      providers: [{ provide: AspirantsService, useValue: aspirantsService }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe("GET /api/aspirants/by-constituency (public)", () => {
    it("returns 200 without a token", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/aspirants/by-constituency?electionId=3&constituencyId=799")
        .expect(200);

      expect(aspirantsService.findByConstituency).toHaveBeenCalled();
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("POST /api/aspirants/visits/:visitId/rate (guarded + validated)", () => {
    it("rejects with 401 when no token is sent", () =>
      request(app.getHttpServer())
        .post("/api/aspirants/visits/10/rate")
        .send({ rating: 4 })
        .expect(401));

    it("rejects with 400 when rating is out of the 1–5 range", () =>
      request(app.getHttpServer())
        .post("/api/aspirants/visits/10/rate")
        .set("Authorization", `Bearer ${signToken()}`)
        .send({ rating: 9 })
        .expect(400));

    it("saves the rating (201), forwarding visitId, user id, and rating", async () => {
      await request(app.getHttpServer())
        .post("/api/aspirants/visits/10/rate")
        .set("Authorization", `Bearer ${signToken({ sub: 57 })}`)
        .send({ rating: 4 })
        .expect(201);

      expect(aspirantsService.rateVisit).toHaveBeenCalledWith(10, 57, 4);
    });

    it("maps a service NotFoundException to HTTP 404", async () => {
      aspirantsService.rateVisit.mockRejectedValueOnce(
        new NotFoundException("Visit not found"),
      );

      await request(app.getHttpServer())
        .post("/api/aspirants/visits/999/rate")
        .set("Authorization", `Bearer ${signToken()}`)
        .send({ rating: 4 })
        .expect(404);
    });
  });

  describe("POST /api/aspirants/:aspirantId/contact/rate (guarded)", () => {
    it("saves a contact rating (201)", async () => {
      await request(app.getHttpServer())
        .post("/api/aspirants/54/contact/rate")
        .set("Authorization", `Bearer ${signToken({ sub: 57 })}`)
        .send({ rating: 5 })
        .expect(201);

      expect(aspirantsService.rateContact).toHaveBeenCalledWith(54, 57, 5);
    });

    it("maps the eligibility BadRequestException to HTTP 400", async () => {
      aspirantsService.rateContact.mockRejectedValueOnce(
        new BadRequestException("only after contacting"),
      );

      await request(app.getHttpServer())
        .post("/api/aspirants/54/contact/rate")
        .set("Authorization", `Bearer ${signToken()}`)
        .send({ rating: 5 })
        .expect(400);
    });
  });
});
