import { z } from "zod";
const id = z.string().min(1).max(128),
  version = z.number().int().min(0).max(2147483647);
const base = {
  schemaVersion: z.literal(1),
  externalId: z.string().trim().min(1).max(120),
  expectedVersion: version,
};
export const bookSchema = z.strictObject({
  ...base,
  title: z.string().min(1).max(100),
  brief: z.string().max(30000).optional(),
  audience: z.string().max(100).optional(),
  style: z.string().min(1).max(80),
  aspectRatio: z
    .enum([
      "21:10",
      "16:9",
      "3:2",
      "4:3",
      "5:4",
      "1:1",
      "4:5",
      "3:4",
      "2:3",
      "9:16",
    ])
    .optional(),
  isSpread: z.boolean().optional(),
  pageCount: z.number().int().min(4).max(24),
  coverAssetId: id.optional(),
  pages: z
    .array(
      z.strictObject({
        position: z.number().int().min(0).max(24),
        caption: z.string().max(500).optional(),
        narration: z.string().max(1000).optional(),
        imagePrompt: z.string().max(2000).optional(),
        textInImage: z.boolean().optional(),
        imageAssetId: id.nullable().optional(),
        audioAssetId: id.nullable().optional(),
      }),
    )
    .max(25),
});
export const albumSchema = z.strictObject({
  ...base,
  title: z.string().min(2).max(80),
  summary: z.string().min(1).max(2000),
  coverAssetId: id,
  items: z
    .array(
      z.strictObject({
        bookId: id,
        expectedVersion: version,
        displayName: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(200),
});
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(["BOOK", "ALBUM"]),
  work: z.record(z.string(), z.unknown()),
  assets: z
    .record(
      z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
      z.strictObject({
        path: z.string().min(1).max(4096),
        externalId: z.string().min(1).max(120).optional(),
        kind: z.enum(["IMAGE", "AUDIO"]),
        mimeType: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "audio/mpeg",
          "audio/wav",
          "audio/mp4",
          "audio/ogg",
        ]),
      }),
    )
    .optional(),
  bindings: z
    .record(
      z
        .string()
        .regex(/^(coverAssetId|pages\.\d+\.(imageAssetId|audioAssetId))$/),
      z.string(),
    )
    .optional(),
});
export const jsonSchemas = {
  book: z.toJSONSchema(bookSchema),
  album: z.toJSONSchema(albumSchema),
  manifest: z.toJSONSchema(manifestSchema),
};
