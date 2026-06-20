import { z } from "zod"

export const ProjectMappingSchema = z.object({
  local: z.string().min(1, "local path must not be empty"),
  remote: z.string().min(1, "remote path must not be empty"),
  excludes: z.array(z.string()),
  commitStudio: z.boolean().optional(),
})

export const SSHConfigSchema = z.object({
  user: z.string(),
  host: z.string(),
  identityFile: z.string(),
  port: z.number().int().min(1).max(65535).optional(),
})

export const TunnelConfigSchema = z.object({
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535),
  host: z.string(),
})

export const StudioConfigSchema = z.object({
  ssh: SSHConfigSchema,
  tunnel: TunnelConfigSchema,
  projects: z.record(z.string(), ProjectMappingSchema),
  defaultExcludes: z.array(z.string()),
})

export type ValidatedStudioConfig = z.infer<typeof StudioConfigSchema>

export function validateConfig(raw: unknown): ValidatedStudioConfig {
  return StudioConfigSchema.parse(raw)
}

export function safeValidateConfig(raw: unknown) {
  return StudioConfigSchema.safeParse(raw)
}
