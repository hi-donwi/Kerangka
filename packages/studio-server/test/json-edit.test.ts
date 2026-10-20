import { describe, expect, it } from "vitest";
import { JsonEditError, findPath, insertEntry, parseJson, setValue } from "../src/index.js";

const multiLine = `{
  "entities": {
    "Request": {
      "fields": {
        "title": "string!"
      }
    }
  }
}
`;

const inline = `{
  "entities": {"Request": {"fields": {"title": "string!"}}},
  "views": {"requests": {"list": "Request"}}
}
`;

describe("format-preserving JSON edit", () => {
  it("parses a document and resolves a nested object path", () => {
    const root = parseJson(multiLine);
    const fields = findPath(root, ["entities", "Request", "fields"]);
    expect(fields?.kind).toBe("object");
    expect(findPath(root, ["entities", "Missing"])).toBeUndefined();
  });

  it("rejects text that is not valid JSON", () => {
    expect(() => parseJson("{")).toThrow(JsonEditError);
  });

  it("inserts a key into a multi-line object and leaves every other byte intact", () => {
    const root = parseJson(multiLine);
    const fields = findPath(root, ["entities", "Request", "fields"])!;
    const next = insertEntry(multiLine, fields, "status", '"string"');
    expect(next).toBe(`{
  "entities": {
    "Request": {
      "fields": {
        "title": "string!",
        "status": "string"
      }
    }
  }
}
`);
  });

  it("inserts a key into an inline object with the matching separator", () => {
    const root = parseJson(inline);
    const fields = findPath(root, ["entities", "Request", "fields"])!;
    expect(insertEntry(inline, fields, "status", '"string"')).toBe(`{
  "entities": {"Request": {"fields": {"title": "string!", "status": "string"}}},
  "views": {"requests": {"list": "Request"}}
}
`);
  });

  it("replaces only a value span", () => {
    const text = `{
  "entities": {
    "Request": {
      "fields": {
        "title": "string!",
        "notes": "text"
      }
    }
  }
}
`;
    const root = parseJson(text);
    const notes = findPath(root, ["entities", "Request", "fields", "notes"])!;
    expect(setValue(text, notes, '{"type":"string"}')).toBe(`{
  "entities": {
    "Request": {
      "fields": {
        "title": "string!",
        "notes": {"type":"string"}
      }
    }
  }
}
`);
  });

  it("refuses to treat a non-object as a key container", () => {
    const root = parseJson(inline);
    const list = findPath(root, ["views", "requests", "list"])!;
    expect(() => insertEntry(inline, list, "extra", "1")).toThrow(JsonEditError);
  });
});
