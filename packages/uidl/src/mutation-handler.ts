/**
 * The host-side executor for UIDL `mutate` actions against a Kerangka backend.
 *
 * The interpreter resolves `mutate.request` (operation, collection, id, payload, transition,
 * version) and calls this handler; it does **not** know Kerangka exists. This module is the one
 * place that turns that request into adapter calls, mirroring the shape UIDL-Runtime's reference
 * handler returns (`templates/src/domain/services/mutationHandler.ts`): create/update/transition
 * yield `{ record, meta }`, delete yields `{ id }`.
 *
 * License: Apache-2.0
 */

import { DataError } from "./errors.js";
import type { DataAdapter, MutationHandler, MutationRequest } from "./types.js";

export interface KerangkaMutationHandlerOptions {
  adapter: DataAdapter;
}

function requireId(request: MutationRequest): string {
  if (request.id === undefined || request.id === null || request.id === "") {
    throw new DataError(`"${request.operation}" for "${request.collection}" requires an id`, "validation", {
      id: "ID is required",
    });
  }
  return String(request.id);
}

function requireTransition(request: MutationRequest): string {
  if (!request.transition) {
    throw new DataError(`"transition" for "${request.collection}" requires a transition name`, "validation", {
      transition: "Transition is required",
    });
  }
  return request.transition;
}

export function createKerangkaMutationHandler(options: KerangkaMutationHandlerOptions): MutationHandler {
  const { adapter } = options;

  return async (request: MutationRequest) => {
    switch (request.operation) {
      case "create":
        return adapter.create({ collection: request.collection, data: request.payload });

      case "update": {
        const id = requireId(request);
        return adapter.update({
          collection: request.collection,
          id,
          data: request.payload,
          version: request.version,
        });
      }

      case "delete": {
        const id = requireId(request);
        await adapter.remove(request.collection, id);
        return { id };
      }

      case "transition": {
        const id = requireId(request);
        const transition = requireTransition(request);
        return adapter.transition({
          collection: request.collection,
          id,
          transition,
          data: request.payload,
          version: request.version,
        });
      }

      default:
        throw new DataError(`Unsupported mutation operation "${String(request.operation)}"`, "validation");
    }
  };
}
