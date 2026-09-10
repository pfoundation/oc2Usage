import { Rpc } from "@opencode/plugin/rpc";

const windowSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
    percent: { type: "number" },
    resetsAt: { type: "string" },
  },
  additionalProperties: false,
} as const;

const scopedSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    status: { type: "string" },
    percent: { type: "number" },
    resetsAt: { type: "string" },
  },
  required: ["label"],
  additionalProperties: false,
} as const;

const providerSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
    percent: { type: "number" },
    label: { type: "string" },
    resetsAt: { type: "string" },
    error: { type: "string" },
    rolling: windowSchema,
    weekly: windowSchema,
    monthly: windowSchema,
    fable: windowSchema,
    scoped: { type: "array", items: scopedSchema },
    product: { type: "string" },
    periodStart: { type: "string" },
    periodEnd: { type: "string" },
  },
  required: ["status"],
  additionalProperties: false,
} as const;

const snapshotSchema = {
  type: "object",
  properties: {
    fetchedAt: { type: "string" },
    grok: providerSchema,
    go: providerSchema,
    anthropic: providerSchema,
    meta: providerSchema,
    openai: providerSchema,
  },
  required: ["fetchedAt", "grok", "go", "anthropic", "meta", "openai"],
  additionalProperties: false,
} as const;

export const Usage = Rpc.define({
  id: "ocUsage",
  methods: {
    get: {
      input: {
        type: "object",
        properties: {
          refresh: { type: "boolean" },
        },
        additionalProperties: false,
      },
      output: snapshotSchema,
    },
  },
  events: {
    updated: {
      schema: snapshotSchema,
    },
  },
});
