/**
 * Kerangka CLI - Init Command
 * Scaffolds a new workspace or single-file application document (PLAN.md §13, §7.3).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";

export interface InitOptions {
  /** Target output directory (default: current directory or template name). */
  output?: string;
  /** Application id / name (kebab-case). */
  name?: string;
  /** Authoring format: 'json' (default) or 'yaml'. */
  format?: "json" | "yaml";
  /** Overwrite existing files if present. */
  force?: boolean;
}

export function initCommand(templateName = "workspace", options: InitOptions = {}): boolean {
  const tName = (templateName || "workspace").toLowerCase();
  const format = options.format ?? "json";
  const ext = format === "yaml" ? "yaml" : "json";

  const appName = options.name ?? (tName === "workspace" ? "my-app" : tName);
  const targetDir = resolve(options.output ?? (tName === "workspace" ? appName : "."));

  try {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    switch (tName) {
      case "todo":
        scaffoldTodo(targetDir, appName, ext);
        break;
      case "invoicing":
        scaffoldInvoicing(targetDir, appName, ext);
        break;
      case "commerce":
        scaffoldCommerce(targetDir, appName, ext);
        break;
      case "workspace":
      default:
        scaffoldWorkspace(targetDir, appName, ext);
        break;
    }

    console.log(`\nSuccessfully initialized Kerangka project '${appName}' at: ${targetDir}`);
    console.log(`\nNext steps:`);
    console.log(`  npx kerangka check ${tName === "todo" || tName === "invoicing" ? `${appName}.kerangka.${ext}` : "."}`);
    console.log(`  npx kerangka lint ${tName === "todo" || tName === "invoicing" ? `${appName}.kerangka.${ext}` : "."}`);
    console.log(`  npx kerangka graph ${tName === "todo" || tName === "invoicing" ? `${appName}.kerangka.${ext}` : "."}`);
    console.log(`  npx kerangka dev ${tName === "todo" || tName === "invoicing" ? `${appName}.kerangka.${ext}` : "."}`);
    console.log("");

    return true;
  } catch (err) {
    console.error(`Error: Failed to initialize project at '${targetDir}': ${(err as Error).message}`);
    return false;
  }
}

function writeDoc(filePath: string, data: unknown, ext: "json" | "yaml"): void {
  const content = ext === "yaml"
    ? stringifyYaml(data)
    : JSON.stringify(data, null, 2) + "\n";
  writeFileSync(filePath, content, "utf8");
}

function scaffoldTodo(targetDir: string, appName: string, ext: "json" | "yaml"): void {
  const doc = {
    kerangka: "0.1",
    app: appName,
    meta: {
      title: "Simple Task Management",
      timezone: "UTC",
    },
    entities: {
      Task: {
        fields: {
          title: "string! >= 3 <= 100",
          completed: "bool = false",
          priority: "enum(low, medium, high) = medium",
          dueAt: "datetime",
        },
        actions: {
          complete: {
            when: "!completed",
            run: {
              completed: true,
            },
          },
        },
      },
    },
  };

  writeDoc(join(targetDir, `${appName}.kerangka.${ext}`), doc, ext);
}

function scaffoldInvoicing(targetDir: string, appName: string, ext: "json" | "yaml"): void {
  const doc = {
    kerangka: "0.1",
    app: appName,
    meta: {
      title: "Invoicing and Billing Lifecycle",
      timezone: "UTC",
    },
    entities: {
      Customer: {
        fields: {
          name: "string! >= 2 <= 100",
          email: "email! unique",
        },
      },
      Invoice: {
        fields: {
          invoiceNumber: "string! unique",
          customerId: "uuid!",
          status: "enum(draft, issued, paid, void) = draft",
          lines: "list(InvoiceLine)",
          subtotal: {
            type: "decimal(12,2)",
            compute: "sum(lines, qty * price)",
          },
          totalAmount: {
            type: "decimal(12,2)",
            compute: "subtotal",
          },
        },
        workflow: {
          field: "status",
          transitions: {
            issue: {
              from: "draft",
              to: "issued",
              when: "count(lines) > 0 && totalAmount > 0",
            },
            pay: {
              from: "issued",
              to: "paid",
            },
            cancel: {
              from: ["draft", "issued"],
              to: "void",
            },
          },
        },
      },
      InvoiceLine: {
        embedded: true,
        fields: {
          description: "string!",
          qty: "int! >= 1",
          price: "decimal(12,2)! >= 0",
        },
      },
    },
  };

  writeDoc(join(targetDir, `${appName}.kerangka.${ext}`), doc, ext);
}

function scaffoldWorkspace(targetDir: string, appName: string, ext: "json" | "yaml"): void {
  const rootManifest = {
    kerangka: "0.1",
    app: appName,
    meta: {
      title: `${appName} Application`,
      timezone: "UTC",
    },
    contexts: ["core"],
    lint: {
      extends: ["kerangka:recommended"],
    },
  };

  writeDoc(join(targetDir, `kerangka.${ext}`), rootManifest, ext);

  // Deploy topology
  const deploy = {
    deploy: "0.1",
    app: appName,
    topologies: {
      monolith: {
        services: {
          api: {
            contexts: ["core"],
            store: "sqlite",
          },
        },
      },
    },
  };
  writeDoc(join(targetDir, "deploy.kerangka.json"), deploy, "json");

  // contexts/core
  const coreDir = join(targetDir, "contexts", "core");
  mkdirSync(join(coreDir, "aggregates"), { recursive: true });
  mkdirSync(join(coreDir, "views"), { recursive: true });
  mkdirSync(join(coreDir, "policies"), { recursive: true });
  mkdirSync(join(coreDir, "tests"), { recursive: true });

  const coreManifest = {
    context: "core",
    description: "Core business domain capabilities",
    glossary: {
      Item: "A tracked domain entity item",
    },
    exports: {
      entities: ["Item"],
      events: ["ItemCreated"],
    },
    events: {
      ItemCreated: {
        itemId: "uuid!",
        name: "string!",
      },
    },
  };
  writeDoc(join(coreDir, `context.kerangka.${ext}`), coreManifest, ext);

  // contexts/core/aggregates/Item
  const itemAggregate = {
    aggregate: "Item",
    fields: {
      name: "string! >= 2 <= 80",
      status: "enum(active, archived) = active",
      createdAt: "datetime",
    },
    actions: {
      archive: {
        when: "status == 'active'",
        run: {
          status: "'archived'",
        },
      },
    },
  };
  writeDoc(join(coreDir, "aggregates", `Item.kerangka.${ext}`), itemAggregate, ext);
}

function scaffoldCommerce(targetDir: string, appName: string, ext: "json" | "yaml"): void {
  const rootManifest = {
    kerangka: "0.1",
    app: appName,
    meta: {
      title: "Modular Commerce Workspace",
      timezone: "UTC",
    },
    contexts: ["orders", "billing", "inventory"],
    lint: {
      extends: ["kerangka:recommended"],
    },
  };
  writeDoc(join(targetDir, `kerangka.${ext}`), rootManifest, ext);

  // Deploy topology
  const deploy = {
    deploy: "0.1",
    app: appName,
    topologies: {
      monolith: {
        services: {
          shop: {
            contexts: ["orders", "billing", "inventory"],
            store: "postgres",
          },
        },
      },
      distributed: {
        services: {
          ordersService: {
            contexts: ["orders"],
            store: "postgres",
          },
          billingService: {
            contexts: ["billing"],
            store: "postgres",
          },
          inventoryService: {
            contexts: ["inventory"],
            store: "postgres",
          },
        },
      },
    },
  };
  writeDoc(join(targetDir, "deploy.kerangka.json"), deploy, "json");

  // Contexts
  for (const c of ["orders", "billing", "inventory"]) {
    const cDir = join(targetDir, "contexts", c);
    mkdirSync(join(cDir, "aggregates"), { recursive: true });
    mkdirSync(join(cDir, "views"), { recursive: true });
    mkdirSync(join(cDir, "policies"), { recursive: true });
  }

  // orders
  const ordersManifest = {
    context: "orders",
    exports: {
      events: ["OrderPlaced"],
    },
    entities: {
      Order: {
        fields: {
          orderNumber: "string! unique",
          customerId: "uuid!",
          status: "enum(draft, placed) = draft",
        },
        workflow: {
          field: "status",
          transitions: {
            place: {
              from: "draft",
              to: "placed",
              then: [{ emit: "OrderPlaced", data: { orderId: "id" } }],
            },
          },
        },
      },
    },
    events: {
      OrderPlaced: {
        orderId: "uuid!",
      },
    },
  };
  writeDoc(join(targetDir, "contexts", "orders", `context.kerangka.${ext}`), ordersManifest, ext);

  // billing
  const billingManifest = {
    context: "billing",
    dependsOn: ["orders"],
    entities: {
      Invoice: {
        fields: {
          invoiceNumber: "string! unique",
          orderId: "uuid!",
          status: "enum(draft, issued, paid) = draft",
        },
      },
    },
    policies: {
      onOrderPlaced: {
        on: "orders.OrderPlaced",
        run: "Invoice.create",
      },
    },
  };
  writeDoc(join(targetDir, "contexts", "billing", `context.kerangka.${ext}`), billingManifest, ext);

  // inventory
  const inventoryManifest = {
    context: "inventory",
    dependsOn: ["orders"],
    entities: {
      Reservation: {
        fields: {
          orderId: "uuid!",
          active: "bool = true",
        },
      },
    },
    policies: {
      onOrderPlaced: {
        on: "orders.OrderPlaced",
        run: "Reservation.create",
      },
    },
  };
  writeDoc(join(targetDir, "contexts", "inventory", `context.kerangka.${ext}`), inventoryManifest, ext);
}
