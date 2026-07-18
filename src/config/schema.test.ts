import { describe, it, expect } from "bun:test"
import { z } from "zod"
import {
  ProjectMappingSchema,
  SSHConfigSchema,
  TunnelConfigSchema,
  validateConfig,
  safeValidateConfig,
} from "./schema"

describe("ProjectMappingSchema", () => {
  it("accepts a valid project mapping", () => {
    const result = ProjectMappingSchema.safeParse({
      local: "/home/user/project",
      remote: "/opt/app/project",
      excludes: [".git/", "node_modules/"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty local path", () => {
    const result = ProjectMappingSchema.safeParse({
      local: "",
      remote: "/opt/app/project",
      excludes: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty remote path", () => {
    const result = ProjectMappingSchema.safeParse({
      local: "/home/user/project",
      remote: "",
      excludes: [],
    })
    expect(result.success).toBe(false)
  })

  it("accepts empty excludes array", () => {
    const result = ProjectMappingSchema.safeParse({
      local: "/home/user/project",
      remote: "/opt/app/project",
      excludes: [],
    })
    expect(result.success).toBe(true)
  })
})

describe("SSHConfigSchema", () => {
  it("accepts a valid SSH config", () => {
    const result = SSHConfigSchema.safeParse({
      user: "dev",
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing user", () => {
    const result = SSHConfigSchema.safeParse({
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing host", () => {
    const result = SSHConfigSchema.safeParse({
      user: "dev",
      identityFile: "/home/dev/.ssh/id_ed25519",
    })
    expect(result.success).toBe(false)
  })

  it("accepts empty user for uninitialized config", () => {
    const result = SSHConfigSchema.safeParse({
      user: "",
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
    })
    expect(result.success).toBe(true)
  })

  it("accepts optional port within valid range", () => {
    const result = SSHConfigSchema.safeParse({
      user: "dev",
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
      port: 2222,
    })
    expect(result.success).toBe(true)
  })

  it("rejects port out of range", () => {
    const result = SSHConfigSchema.safeParse({
      user: "dev",
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
      port: 0,
    })
    expect(result.success).toBe(false)
  })

  it("rejects string port instead of number", () => {
    const result = SSHConfigSchema.safeParse({
      user: "dev",
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
      port: "not-a-number",
    })
    expect(result.success).toBe(false)
  })

  it("accepts optional port", () => {
    const result = SSHConfigSchema.safeParse({
      user: "dev",
      host: "remote.example.com",
      identityFile: "/home/dev/.ssh/id_ed25519",
      port: 2222,
    })
    expect(result.success).toBe(true)
  })
})

describe("TunnelConfigSchema", () => {
  it("accepts a valid tunnel config", () => {
    const result = TunnelConfigSchema.safeParse({
      localPort: 8443,
      remotePort: 8443,
      host: "remote.example.com",
    })
    expect(result.success).toBe(true)
  })

  it("rejects localPort out of range", () => {
    const result = TunnelConfigSchema.safeParse({
      localPort: 99999,
      remotePort: 8443,
      host: "remote.example.com",
    })
    expect(result.success).toBe(false)
  })

  it("rejects localPort of 0", () => {
    const result = TunnelConfigSchema.safeParse({
      localPort: 0,
      remotePort: 8443,
      host: "remote.example.com",
    })
    expect(result.success).toBe(false)
  })

  it("rejects remotePort out of range", () => {
    const result = TunnelConfigSchema.safeParse({
      localPort: 8443,
      remotePort: 70000,
      host: "remote.example.com",
    })
    expect(result.success).toBe(false)
  })

  it("accepts empty host before setup", () => {
    const result = TunnelConfigSchema.safeParse({
      localPort: 8443,
      remotePort: 8443,
      host: "",
    })
    expect(result.success).toBe(true)
  })

  it("rejects non-integer port values", () => {
    const result = TunnelConfigSchema.safeParse({
      localPort: 8443.5,
      remotePort: 8443,
      host: "remote.example.com",
    })
    expect(result.success).toBe(false)
  })
})

describe("StudioConfigSchema", () => {
  const validConfig = {
    ssh: { user: "dev", host: "remote.example.com", identityFile: "/home/dev/.ssh/id_ed25519" },
    tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
    projects: {},
    defaultExcludes: [".git/"],
  }

  it("accepts a valid full config", () => {
    const result = safeValidateConfig(validConfig)
    expect(result.success).toBe(true)
  })

  it("accepts empty projects object", () => {
    const result = safeValidateConfig(validConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.projects).toEqual({})
    }
  })

  it("accepts unknown/extra fields (passthrough)", () => {
    const result = safeValidateConfig({
      ...validConfig,
      extraField: "should be allowed",
      anotherExtra: 42,
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing SSH config", () => {
    const { ssh, ...noSSH } = validConfig as any
    const result = safeValidateConfig(noSSH)
    expect(result.success).toBe(false)
  })

  it("rejects missing tunnel config", () => {
    const { tunnel, ...noTunnel } = validConfig as any
    const result = safeValidateConfig(noTunnel)
    expect(result.success).toBe(false)
  })

  it("rejects missing defaultExcludes", () => {
    const { defaultExcludes, ...noExcludes } = validConfig as any
    const result = safeValidateConfig(noExcludes)
    expect(result.success).toBe(false)
  })

  it("accepts optional remote allowlists", () => {
    const result = safeValidateConfig({
      ...validConfig,
      remote: {
        allowedHosts: ["dev", "staging"],
        allowedCommandPrefixes: ["npm ", "bun test"],
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.remote?.allowedHosts).toEqual(["dev", "staging"])
      expect(result.data.remote?.allowedCommandPrefixes).toEqual(["npm ", "bun test"])
    }
  })

  it("accepts config without remote (optional)", () => {
    const result = safeValidateConfig(validConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.remote).toBeUndefined()
    }
  })
})

describe("validateConfig (unsafe)", () => {
  it("returns parsed config on valid input", () => {
    const result = validateConfig({
      ssh: { user: "dev", host: "h", identityFile: "/key" },
      tunnel: { localPort: 8443, remotePort: 8443, host: "h" },
      projects: {},
      defaultExcludes: [],
    })
    expect(result.ssh.user).toBe("dev")
    expect(result.tunnel.localPort).toBe(8443)
  })

  it("throws ZodError on invalid input", () => {
    expect(() => validateConfig({})).toThrow(z.ZodError)
  })
})

describe("safeValidateConfig", () => {
  it("returns error object (not throw) on invalid input", () => {
    const result = safeValidateConfig({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError)
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })

  it("reports specific field errors", () => {
    const result = safeValidateConfig({
      ssh: { user: "u", host: "h", identityFile: "/k", port: 99999 },
      tunnel: { localPort: 8443, remotePort: 8443, host: "h" },
      projects: {},
      defaultExcludes: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.path.join("."))
      expect(messages).toContain("ssh.port")
    }
  })
})
