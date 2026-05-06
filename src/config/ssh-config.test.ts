import { describe, it, expect } from "bun:test"
import { writeFileSync, unlinkSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { homedir } from "os"
import { parseSSHConfig } from "./ssh-config"

function testParse(content: string) {
  const tmp = join(tmpdir(), `ssh-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  writeFileSync(tmp, content)
  const result = parseSSHConfig(tmp)
  unlinkSync(tmp)
  return result
}

describe("parseSSHConfig", () => {
  it("parses a single host with all fields", () => {
    const hosts = testParse(`
      Host myserver
        HostName 192.168.1.1
        User admin
        IdentityFile ~/.ssh/id_rsa
        Port 2222
    `)

    expect(hosts).toHaveLength(1)
    expect(hosts[0].alias).toBe("myserver")
    expect(hosts[0].host).toBe("192.168.1.1")
    expect(hosts[0].user).toBe("admin")
    expect(hosts[0].identityFile).toBe(join(homedir(), ".ssh/id_rsa"))
    expect(hosts[0].port).toBe(2222)
  })

  it("parses multi-alias host into separate entries", () => {
    const hosts = testParse(`
      Host foo bar baz
        HostName example.com
        User testuser
    `)

    expect(hosts).toHaveLength(3)
    expect(hosts.map((h) => h.alias)).toEqual(["foo", "bar", "baz"])
    for (const h of hosts) {
      expect(h.host).toBe("example.com")
      expect(h.user).toBe("testuser")
    }
  })

  it("skips wildcard host (Host *)", () => {
    const hosts = testParse(`
      Host *
        User defaultuser
        IdentityFile ~/.ssh/default

      Host specific
        HostName 10.0.0.1
        User admin
    `)

    expect(hosts).toHaveLength(1)
    expect(hosts[0].alias).toBe("specific")
    expect(hosts[0].host).toBe("10.0.0.1")
    expect(hosts[0].user).toBe("admin")
  })

  it("skips host with wildcard patterns", () => {
    const hosts = testParse(`
      Host *.example.com
        User webuser

      Host server?.local
        User dev

      Host concrete
        HostName 10.0.0.2
    `)

    expect(hosts).toHaveLength(1)
    expect(hosts[0].alias).toBe("concrete")
  })

  it("returns empty array for empty config", () => {
    const hosts = testParse("")
    expect(hosts).toEqual([])
  })

  it("returns empty array for config with only comments", () => {
    const hosts = testParse(`
      # This is a comment
      # Another comment
      # Host myhost
      #   HostName example.com
    `)
    expect(hosts).toEqual([])
  })

  it("expands ~/ in IdentityFile to home directory", () => {
    const hosts = testParse(`
      Host myhost
        HostName example.com
        User me
        IdentityFile ~/.ssh/mykey
    `)

    expect(hosts).toHaveLength(1)
    expect(hosts[0].identityFile).toBe(join(homedir(), ".ssh/mykey"))
    expect(hosts[0].identityFile).not.toContain("~/")
  })

  it("returns empty array when config file does not exist", () => {
    const result = parseSSHConfig("/tmp/nonexistent-ssh-config-xyz123")
    expect(result).toEqual([])
  })

  it("parses multiple hosts correctly", () => {
    const hosts = testParse(`
      Host alpha
        HostName 10.0.0.1
        User user1

      Host beta
        HostName 10.0.0.2
        User user2
        Port 2222

      Host gamma
        HostName 10.0.0.3
    `)

    expect(hosts).toHaveLength(3)
    expect(hosts[0].alias).toBe("alpha")
    expect(hosts[0].host).toBe("10.0.0.1")
    expect(hosts[0].user).toBe("user1")

    expect(hosts[1].alias).toBe("beta")
    expect(hosts[1].host).toBe("10.0.0.2")
    expect(hosts[1].user).toBe("user2")
    expect(hosts[1].port).toBe(2222)

    expect(hosts[2].alias).toBe("gamma")
    expect(hosts[2].host).toBe("10.0.0.3")
    expect(hosts[2].user).toBeUndefined()
  })

  it("parses port as a number", () => {
    const hosts = testParse(`
      Host special
        HostName myhost.com
        User me
        Port 443
    `)

    expect(hosts).toHaveLength(1)
    expect(hosts[0].port).toBe(443)
    expect(typeof hosts[0].port).toBe("number")
  })

  it("parses real ~/.ssh/config correctly", () => {
    const hosts = parseSSHConfig()

    // Should find at least the hosts we know exist
    const aliases = hosts.map((h) => h.alias)
    expect(aliases).toContain("Arasaka")
    expect(aliases).toContain("skynet-vps")
    expect(aliases).toContain("skynet-vps-root")

    // Check skynet-vps details
    const skynet = hosts.find((h) => h.alias === "skynet-vps")
    expect(skynet).toBeDefined()
    expect(skynet!.host).toBe("103.47.224.118")
    expect(skynet!.user).toBe("breixopd14")

    // Check Arasaka
    const arasaka = hosts.find((h) => h.alias === "Arasaka")
    expect(arasaka).toBeDefined()
    expect(arasaka!.host).toBe("54.38.194.21")
    expect(arasaka!.user).toBe("ubuntu")

    // militech alias should also exist
    expect(aliases).toContain("militech")

    // Check multi-alias: skynet-vps and militech should have same host
    const militech = hosts.find((h) => h.alias === "militech")
    expect(militech).toBeDefined()
    expect(militech!.host).toBe("103.47.224.118")
  })
})
