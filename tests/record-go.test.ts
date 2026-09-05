import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getByMetadataId, getBySequence, getByEntityId } = vi.hoisted(() => ({
  getByMetadataId: vi.fn(),
  getBySequence: vi.fn(),
  getByEntityId: vi.fn(),
}));
vi.mock("../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: {
    getByMetadataId,
    getBySequence,
    get: getByEntityId,
  },
}));

vi.mock("../server/storage/entity-metadata-record-tables", () => ({
  metadataRecordHref: vi.fn((contextId: string, entityId: string) =>
    contextId === "workers" ? `/workers/${entityId}` : null,
  ),
}));
const {
  parseRecordGoIdentifier,
  resolveRecordGoIdentifier,
} = await import("../server/services/record-go");
const { registerRecordGoRoutes } = await import("../server/modules/record-go");
const { recordGoDestination } = await import("../client/src/pages/record-go");

const METADATA_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";
const metadata = {
  seq: 123,
  rev: 4,
  contextId: "workers",
  entityId: ENTITY_ID,
  created: { date: null, personName: null },
  modified: { date: null, personName: null },
  subrecordModified: { date: null, personName: null },
};

describe("record go identifier parsing and resolution", () => {
  beforeEach(() => {
    getByMetadataId.mockReset().mockResolvedValue(undefined);
    getBySequence.mockReset().mockResolvedValue(undefined);
    getByEntityId.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    [METADATA_ID, { kind: "uuid", value: METADATA_ID }],
    [ENTITY_ID, { kind: "uuid", value: ENTITY_ID }],
    ["123", { kind: "sequence", value: 123 }],
    ["000.0123", { kind: "sequence", value: 123 }],
    ["000.0123::0004", { kind: "sequence", value: 123, revision: 4 }],
    ["000.0123::9999", { kind: "sequence", value: 123, revision: 9999 }],
  ])("parses %s", (input, expected) => {
    expect(parseRecordGoIdentifier(input)).toEqual(expected);
  });

  it.each(["", "not-an-id", "000..0123", "000.0123::", "000.0123::bad", "1::2::3"])(
    "rejects malformed identifier %s",
    (input) => {
      expect(parseRecordGoIdentifier(input)).toBeNull();
    },
  );

  it("looks up a metadata-row UUID before falling back to an entity UUID", async () => {
    getByMetadataId.mockResolvedValueOnce(undefined);
    getByEntityId.mockResolvedValueOnce(metadata);

    await expect(resolveRecordGoIdentifier(ENTITY_ID)).resolves.toEqual({
      kind: "resolved",
      metadata,
      href: `/workers/${ENTITY_ID}`,
    });
    expect(getByMetadataId).toHaveBeenCalledWith(ENTITY_ID);
    expect(getByEntityId).toHaveBeenCalledWith(ENTITY_ID);
  });

  it("resolves raw and grouped sequences and ignores stale revision text", async () => {
    getBySequence.mockResolvedValue(metadata);

    await expect(resolveRecordGoIdentifier("000.0123::9999")).resolves.toMatchObject({
      kind: "resolved",
      href: `/workers/${ENTITY_ID}`,
    });
    expect(getBySequence).toHaveBeenCalledWith(123);
  });

  it("distinguishes unknown rows from rows without a destination page", async () => {
    await expect(resolveRecordGoIdentifier("000.0999")).resolves.toEqual({
      kind: "not_found",
      reason: "unknown",
    });

    getBySequence.mockResolvedValue({ ...metadata, contextId: "contact_phone" });
    await expect(resolveRecordGoIdentifier("000.0123")).resolves.toEqual({
      kind: "not_found",
      reason: "no_page",
    });
  });
});

describe("record go route", () => {
  let baseUrl = "";
  let server: http.Server;

  beforeAll(async () => {
    const app = express();
    registerRecordGoRoutes(app, (req, res, next) => {
      if (req.header("x-authenticated") !== "yes") {
        res.status(401).send("Sign in required");
        return;
      }
      next();
    });
    server = http.createServer(app);
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  });

  beforeEach(() => {
    getByMetadataId.mockReset().mockResolvedValue(undefined);
    getBySequence.mockReset().mockResolvedValue(undefined);
    getByEntityId.mockReset().mockResolvedValue(undefined);
  });

  it("requires authentication without metadata.view", async () => {
    const response = await fetch(`${baseUrl}/go/${ENTITY_ID}`);
    expect(response.status).toBe(401);
    expect(getByMetadataId).not.toHaveBeenCalled();
    expect(getByEntityId).not.toHaveBeenCalled();
  });

  it("redirects authenticated users to the declared record page", async () => {
    getBySequence.mockResolvedValue(metadata);

    const response = await fetch(`${baseUrl}/go/${encodeURIComponent("000.0123::0004")}`, {
      headers: { "x-authenticated": "yes" },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/workers/${ENTITY_ID}`);
  });

  it("explains unknown and page-less records", async () => {
    const unknown = await fetch(`${baseUrl}/go/nope`, {
      headers: { "x-authenticated": "yes" },
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("Record not found");

    getByMetadataId.mockResolvedValue({ ...metadata, contextId: "contact_phone" });
    const noPage = await fetch(`${baseUrl}/go/${ENTITY_ID}`, {
      headers: { "x-authenticated": "yes" },
    });
    expect(noPage.status).toBe(404);
    expect(await noPage.text()).toContain("This record has no page");
  });
});

describe("record go form submission", () => {
  it("keeps empty input on the form with a validation error", () => {
    expect(recordGoDestination("   ")).toEqual({
      error: "Enter a record ID, metadata ID, or record sequence.",
    });
  });

  it("uses the shared /go/:id resolution path for pasted identifiers", () => {
    expect(recordGoDestination("  000.0123::0004  ")).toEqual({
      href: "/go/000.0123%3A%3A0004",
    });
  });
});
