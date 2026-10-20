import { expect, test } from "@playwright/test";

const SAMPLES = 3;
const JS_BUDGET_BYTES = 400 * 1024;

test.describe("kitchen sink execution", () => {
  test("golden path: run real approval outcomes without host I/O", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));

    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Kerangka Kitchen Sink");

    const nav = page.getByRole("navigation", { name: "samples" });
    await expect(nav.getByRole("button")).toHaveCount(SAMPLES);

    await expect(page.locator("section.sample h2")).toHaveText("Expense Approval");
    await page.getByRole("button", { name: "Run submit-draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("PASS: ok");
    await expect(page.getByRole("status")).toContainText('"status": "submitted"');
    await page.getByRole("button", { name: "Run approve-as-manager", exact: true }).click();
    await expect(page.getByRole("status")).toContainText('"status": "approved"');
    await page.getByRole("button", { name: "Run approve-as-employee", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("PASS: denied");
    await expect(page.getByRole("status")).toContainText("PERMISSION_DENIED");

    await nav.getByRole("button", { name: "Action, Workflow, and Decision" }).click();
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");
    await expect(page.getByRole("heading", { name: "Expected outcomes" })).toBeVisible();

    await nav.getByRole("button", { name: "Field, Expression, and Validation" }).click();
    await expect(page.locator("section.sample h2")).toHaveText("Field, Expression, and Validation");

    const mutating = requests.filter((m) => !m.startsWith("GET ") && !m.startsWith("HEAD "));
    expect(mutating, "preview mode must not send mutating requests").toEqual([]);

    const crossOrigin = requests.filter(
      (m) => !m.includes("127.0.0.1:4173") && !m.includes("localhost:4173"),
    );
    expect(crossOrigin, "preview mode must not call third-party hosts").toEqual([]);
  });

  test("reload preserves the selected sample but resets execution", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "samples" });
    await nav.getByRole("button", { name: "Action, Workflow, and Decision" }).click();
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");

    await page.reload();
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");
    await expect(page.getByRole("status")).toContainText("Choose an input");
  });

  test("deep links support reload and back/forward without serializing fixture data", async ({ page }) => {
    await page.goto("/?sample=workflow&record=fixture#actor");
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");
    await expect(page).toHaveURL(/\/\?sample=workflow$/);
    const nav = page.getByRole("navigation", { name: "samples" });
    await nav.getByRole("button", { name: "Field, Expression, and Validation" }).click();
    await expect(page).toHaveURL(/\/\?sample=validation$/);
    await page.goBack();
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");
    await page.goForward();
    await expect(page.locator("section.sample h2")).toHaveText("Field, Expression, and Validation");
    await page.getByRole("button", { name: "Run empty-invoice", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("PASS: denied");
    await page.getByRole("button", { name: "Reset sample" }).click();
    await expect(page.getByRole("status")).toContainText("Choose an input");
    await expect(page).toHaveURL(/\/\?sample=validation$/);
    await page.reload();
    await expect(page.locator("section.sample h2")).toHaveText("Field, Expression, and Validation");
  });

  test("unknown sample URLs safely fall back to the default ID", async ({ page }) => {
    await page.goto("/?sample=__proto__&actor=fixture#state");
    await expect(page.locator("section.sample h2")).toHaveText("Expense Approval");
    await expect(page).toHaveURL(/\/\?sample=approval$/);
  });

  test("validation and workflow execute all declared inputs; reset clears results", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "samples" });
    await nav.getByRole("button", { name: "Field, Expression, and Validation" }).click();
    await page.getByRole("button", { name: "Run empty-invoice", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("PASS: denied");
    await expect(page.getByRole("status")).toContainText("GUARD_FAILED");
    await nav.getByRole("button", { name: "Action, Workflow, and Decision" }).click();
    for (const [input, role] of [["submit-2-days", "team-lead"], ["submit-6-days", "hr-director"]]) {
      await page.getByRole("button", { name: `Run ${input}`, exact: true }).click();
      await expect(page.getByRole("status")).toContainText("PASS: ok");
      await expect(page.getByRole("status")).toContainText(`"assignedApproverRole": "${role}"`);
    }
    await page.getByRole("button", { name: "Reset sample" }).click();
    await expect(page.getByRole("status")).toContainText("Choose an input");
    await expect(page.getByRole("status")).not.toContainText("PASS");
    expect(errors).toEqual([]);
  });

  test("terminates a busy worker and shows source with the timeout reason", async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(_url: string | URL, options?: WorkerOptions) {
          super(URL.createObjectURL(new Blob(["while (true) {}"], { type: "text/javascript" })), options);
        }
      };
    });
    let closed = 0;
    page.on("worker", (worker) => worker.on("close", () => closed++));
    await page.goto("/");
    await page.getByRole("button", { name: "Run submit-draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("TIME_LIMIT");
    await expect(page.getByRole("status")).toContainText("Source-only fallback");
    await expect(page.getByText('"app": "expense-approval"', { exact: false })).toBeVisible();
    await expect.poll(() => closed).toBe(1);
    await page.getByRole("button", { name: "Reset sample" }).click();
    await expect(page.getByRole("status")).toContainText("Choose an input");
  });

  test("reset and sample navigation terminate an in-flight worker", async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(_url: string | URL, options?: WorkerOptions) {
          super(URL.createObjectURL(new Blob(["while (true) {}"], { type: "text/javascript" })), options);
        }
      };
    });
    let closed = 0;
    page.on("worker", (worker) => worker.on("close", () => closed++));
    await page.goto("/");
    await page.getByRole("button", { name: "Run submit-draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Running submit-draft");
    await page.getByRole("button", { name: "Reset sample" }).click();
    await expect.poll(() => closed).toBe(1);
    await expect(page.getByRole("status")).toContainText("Choose an input");
    await page.getByRole("button", { name: "Run submit-draft", exact: true }).click();
    await page.getByRole("navigation", { name: "samples" }).getByRole("button").last().click();
    await expect.poll(() => closed).toBe(2);
    await expect(page.getByRole("status")).toContainText("Choose an input");
  });

  test("production CSP blocks network connections in both page and blob worker", async ({ page }) => {
    let reachedNetwork = false;
    await page.route("**/io-probe", async (route) => {
      reachedNetwork = true;
      await route.fulfill({ body: "must not be reached" });
    });
    await page.goto("/");
    const blocked = await page.evaluate(async () => {
      const url = `${location.origin}/io-probe`;
      let pageBlocked = false;
      try { await fetch(url); } catch { pageBlocked = true; }
      const workerUrl = URL.createObjectURL(new Blob([
        "onmessage = async (event) => { try { await fetch(event.data); postMessage(false); } catch { postMessage(true); } };",
      ], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      const workerBlocked = await new Promise<boolean>((resolve) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.postMessage(url);
      });
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      return { pageBlocked, workerBlocked };
    });
    expect(blocked).toEqual({ pageBlocked: true, workerBlocked: true });
    expect(reachedNetwork).toBe(false);
  });

  test("mobile and desktop render execution results without horizontal overflow", async ({ page }) => {
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/");
      await page.getByRole("button", { name: "Run submit-draft", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("PASS: ok");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `page must not scroll horizontally at ${width}px`).toBeLessThanOrEqual(0);
      if (width === 375 || width === 1440) {
        await page.screenshot({ path: test.info().outputPath(`execution-${width}.png`), fullPage: true });
      }
    }
  });

  test("keyboard: tab reaches samples, Enter selects, focus stays visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const nav = page.getByRole("navigation", { name: "samples" });
    const firstButton = nav.getByRole("button").first();
    await expect(firstButton).toBeFocused();

    const outline = await firstButton.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle}:${s.outlineWidth}`;
    });
    expect(outline, "focused sample button needs a visible outline").not.toContain("none");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");

    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(activeTag).toBe("BUTTON");
  });

  test("UIDL preview renders a generated screen without host writes", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Show UIDL preview", exact: true }).click();
    const screens = page.getByRole("group", { name: "UIDL screens" });
    await expect(screens.getByRole("button", { name: "expenses", exact: true })).toBeVisible();
    await screens.getByRole("button", { name: "expenses", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "UIDL preview must not widen the page").toBeLessThanOrEqual(0);
    expect(requests.filter((entry) => !entry.startsWith("GET ") && !entry.startsWith("HEAD "))).toEqual([]);
    expect(requests.filter((entry) => !entry.includes("127.0.0.1:4173") && !entry.includes("localhost:4173"))).toEqual([]);
  });

  test("execution budget: static assets stay under the JS budget", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Run submit-draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("PASS: ok");
    await page.getByRole("navigation", { name: "samples" }).getByRole("button").last().click();

    const jsBytes = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((r) => r.name.endsWith(".js"))
        .reduce((sum, r) => sum + (r as PerformanceResourceTiming).encodedBodySize, 0),
    );
    expect(jsBytes, "JS transfer budget").toBeGreaterThan(0);
    expect(jsBytes, "JS transfer budget").toBeLessThan(JS_BUDGET_BYTES);
  });
});
