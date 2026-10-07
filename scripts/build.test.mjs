import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { orderPackages, readWorkspacePackages } from "./build-order.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const package_ = (name, dependencies = []) => ({
  path: `packages/${name}`,
  dir: `packages/${name}`,
  name,
  dependencies,
  hasBuild: true,
});

describe("workspace build order", () => {
  it("builds every workspace package after the workspace packages it depends on", () => {
    const packages = readWorkspacePackages(repoRoot);
    expect(packages.length).toBeGreaterThan(0);

    const ordered = orderPackages(packages);
    expect(ordered.map((pkg) => pkg.name).sort()).toEqual(packages.map((pkg) => pkg.name).sort());

    const position = new Map(ordered.map((pkg, index) => [pkg.name, index]));
    for (const pkg of packages) {
      for (const dep of pkg.dependencies) {
        if (!position.has(dep)) continue;
        expect(position.get(dep), `${pkg.name} must not build before ${dep}`).toBeLessThan(
          position.get(pkg.name)
        );
      }
    }
  });

  it("puts a leaf package before everything that needs its build output", () => {
    const ordered = orderPackages([
      package_("cli", ["compiler", "server"]),
      package_("server", ["compiler"]),
      package_("compiler", ["k1"]),
      package_("k1"),
    ]);
    expect(ordered.map((pkg) => pkg.name)).toEqual(["k1", "compiler", "server", "cli"]);
  });

  it("is deterministic when several packages become ready at once", () => {
    const input = [package_("b"), package_("a"), package_("c")];
    expect(orderPackages(input).map((pkg) => pkg.name)).toEqual(["a", "b", "c"]);
    expect(orderPackages([...input].reverse()).map((pkg) => pkg.name)).toEqual(["a", "b", "c"]);
  });

  it("ignores dependencies that are not workspace packages", () => {
    const ordered = orderPackages([package_("a", ["typescript", "@kerangka/missing"])]);
    expect(ordered.map((pkg) => pkg.name)).toEqual(["a"]);
  });

  it("refuses a cycle instead of building an arbitrary order", () => {
    const cycle = [package_("a", ["b"]), package_("b", ["a"])];
    expect(() => orderPackages(cycle)).toThrow(/Dependency cycle among workspace packages: a, b/);
  });

  it("refuses two packages with the same name", () => {
    expect(() => orderPackages([package_("a"), package_("a")])).toThrow(
      /Duplicate workspace package name: a/
    );
  });
});
