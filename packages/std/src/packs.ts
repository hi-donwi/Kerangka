/**
 * Official Packs
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Feature packs that ship with the compiler, versioned in lockstep with it (ADR-0006,
 * ADR-0043). Unlike `@kerangka/std`, a pack is loaded only when a document names it in
 * `packages`. Each one is a set of templates; an entity template is placed under a name the
 * document chooses, so a pack never claims a name in someone else's model.
 *
 * Packs hold logic only: who belongs where, who may do what. Checking a password or a token
 * stays in the host adapter that produces the actor, and screens come from UIDL-Runtime.
 */

import type { StdPackageManifest } from "./types.js";

export const IDENTITY_PACKAGE: StdPackageManifest = {
  package: "@kerangka/identity",
  version: "0.1.0",
  description:
    "Organizations and their members, with an invite, accept, suspend, reactivate lifecycle and owner, admin, and member roles",
  templates: {
    organization: {
      template: "organization",
      type: "entity",
      description: "A tenant: one company or team whose members share its records",
      params: {
        ownerRole: { default: "owner", description: "the role that may change the organization" },
        readers: { default: ["owner", "admin", "member"], description: "the roles that may read it, as a list" },
      },
      traits: ["std:auditable"],
      fields: {
        name: "string! >= 2 <= 80",
        slug: "string! unique",
      },
      permissions: {
        read: "${readers}",
        create: ["${ownerRole}"],
        update: ["${ownerRole}"],
        delete: ["${ownerRole}"],
      },
    },
    member: {
      template: "member",
      type: "entity",
      description:
        "A person's membership of an organization: invited, then active, possibly suspended. The owner cannot be suspended or demoted",
      params: {
        organization: { default: "Organization", description: "the entity members belong to" },
        ownerRole: { default: "owner" },
        adminRole: { default: "admin" },
        memberRole: { default: "member" },
      },
      traits: ["std:auditable"],
      fields: {
        organization: "ref(${organization})!",
        email: "email!",
        displayName: "string",
        role: "enum(${ownerRole}, ${adminRole}, ${memberRole}) = ${memberRole}",
        status: "enum(invited, active, suspended) = invited",
      },
      permissions: {
        read: ["${ownerRole}", "${adminRole}", "${memberRole}"],
        create: ["${ownerRole}", "${adminRole}"],
        update: ["${ownerRole}", "${adminRole}"],
        delete: ["${ownerRole}"],
      },
      workflow: {
        field: "status",
        initial: "invited",
        transitions: {
          accept: { from: "invited", to: "active", roles: ["${ownerRole}", "${adminRole}", "${memberRole}"] },
          suspend: { from: "active", to: "suspended", roles: ["${ownerRole}", "${adminRole}"], when: "role != '${ownerRole}'" },
          reactivate: { from: "suspended", to: "active", roles: ["${ownerRole}", "${adminRole}"] },
        },
      },
      actions: {
        changeRole: {
          roles: ["${ownerRole}"],
          input: { newRole: "enum(${adminRole}, ${memberRole})!" },
          when: "status == 'active' && role != '${ownerRole}'",
          run: { role: "input.newRole" },
        },
      },
    },
  },
};

export const ADMIN_PACKAGE: StdPackageManifest = {
  package: "@kerangka/admin",
  version: "0.1.0",
  description: "Back-office building blocks: an append-only audit trail",
  templates: {
    auditEntry: {
      template: "auditEntry",
      type: "entity",
      description:
        "One recorded operation. Written by the host or a policy, read by auditors, never changed or deleted",
      params: {
        auditorRole: { default: "admin", description: "the role that may read the trail" },
        writerRole: { default: "system", description: "the role the host or a policy writes with" },
      },
      fields: {
        at: { type: "datetime!", default: "now()" },
        actorId: "string!",
        operation: "string!",
        subject: "string!",
        subjectId: "string",
        details: "string",
      },
      permissions: {
        read: ["${auditorRole}"],
        create: ["${writerRole}"],
        update: [],
        delete: [],
      },
    },
  },
};

/** Packs the resolver loads by name, without looking for an installed package. */
export const OFFICIAL_PACKS: Record<string, StdPackageManifest> = {
  [IDENTITY_PACKAGE.package]: IDENTITY_PACKAGE,
  [ADMIN_PACKAGE.package]: ADMIN_PACKAGE,
};
