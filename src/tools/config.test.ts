import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockLoadConfig = mock(() => ({
  ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
  tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
  projects: {},
  defaultExcludes: [".git/"],
}))

const mockAddProject = mock(() => {})
const mockRemoveProject = mock(() => {})

mock.module("../config/config", () => ({
  loadConfig: mockLoadConfig,
  addProject: mockAddProject,
  removeProject: mockRemoveProject,
}))

const { studio_add_project, studio_remove_project } = await import("./config")

const ctx: any = null!

describe("studio_add_project", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockAddProject.mockClear()
    mockRemoveProject.mockClear()
  })

  it("adds a project and returns success message", async () => {
    const result = await studio_add_project.execute(
      {
        name: "myapp",
        local: "/home/user/myapp",
        remote: "/opt/app/myapp",
        excludes: [".git/"],
      },
      ctx,
    )

    expect(result).toContain("Project 'myapp' added")
    expect(result).toContain("/home/user/myapp")
    expect(result).toContain("remote.example.com:/opt/app/myapp")
    expect(mockAddProject).toHaveBeenCalledWith(
      expect.anything(),
      "myapp",
      "/home/user/myapp",
      "/opt/app/myapp",
      [".git/"],
    )
  })

  it("handles missing excludes (undefined)", async () => {
    const result = await studio_add_project.execute(
      {
        name: "myapp",
        local: "/home/user/myapp",
        remote: "/opt/app/myapp",
      },
      ctx,
    )

    expect(result).toContain("Project 'myapp' added")
    expect(mockAddProject).toHaveBeenCalledWith(
      expect.anything(),
      "myapp",
      "/home/user/myapp",
      "/opt/app/myapp",
      undefined,
    )
  })

  it("returns error when addProject throws", async () => {
    mockAddProject.mockImplementationOnce(() => {
      throw new Error("Local path does not exist: /fake/path")
    })

    const result = await studio_add_project.execute(
      {
        name: "ghost",
        local: "/fake/path",
        remote: "/opt/ghost",
      },
      ctx,
    )

    expect(result).toContain("Error adding project")
    expect(result).toContain("Local path does not exist")
  })

  it("returns error for duplicate project name", async () => {
    mockAddProject.mockImplementationOnce(() => {
      throw new Error("Project 'myapp' already exists")
    })

    const result = await studio_add_project.execute(
      {
        name: "myapp",
        local: "/home/user/myapp",
        remote: "/opt/app/myapp",
      },
      ctx,
    )

    expect(result).toContain("Error adding project")
    expect(result).toContain("already exists")
  })

  it("calls loadConfig on each execution", async () => {
    await studio_add_project.execute(
      {
        name: "myapp",
        local: "/home/user/myapp",
        remote: "/opt/app/myapp",
      },
      ctx,
    )

    expect(mockLoadConfig).toHaveBeenCalledTimes(1)
  })
})

describe("studio_remove_project", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockAddProject.mockClear()
    mockRemoveProject.mockClear()
  })

  it("removes a project and returns success message", async () => {
    const result = await studio_remove_project.execute({ name: "myapp" }, ctx)

    expect(result).toBe("Project 'myapp' removed.")
    expect(mockRemoveProject).toHaveBeenCalledWith(expect.anything(), "myapp")
  })

  it("returns error when removing non-existent project", async () => {
    mockRemoveProject.mockImplementationOnce(() => {
      throw new Error("Project 'ghost' not found")
    })

    const result = await studio_remove_project.execute({ name: "ghost" }, ctx)

    expect(result).toContain("Error removing project")
    expect(result).toContain("not found")
  })

  it("calls loadConfig on each execution", async () => {
    await studio_remove_project.execute({ name: "myapp" }, ctx)

    expect(mockLoadConfig).toHaveBeenCalledTimes(1)
  })
})
