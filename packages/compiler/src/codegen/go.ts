/**
 * Kerangka Go Struct Code Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { FieldDefinition, KIRDocument } from "../types.js";

export class GoCodegen {
  static generate(kir: KIRDocument, packageName: string = "model"): string {
    const lines: string[] = [
      `package ${packageName}`,
      "",
      "import (",
      '\t"time"',
      '\t"github.com/shopspring/decimal"',
      ")",
      ""
    ];

    // Enums
    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      for (const [fieldName, field] of Object.entries(entity.fields)) {
        if (field.type === "enum" && field.values && field.values.length > 0) {
          const enumType = `${entityName}${this.toPascalCase(fieldName)}`;
          lines.push(`type ${enumType} string\n`);
          lines.push("const (");
          for (const val of field.values) {
            const constName = `${enumType}${this.toPascalCase(val)}`;
            lines.push(`\t${constName} ${enumType} = "${val}"`);
          }
          lines.push(")\n");
        }
      }
    }

    // Structs
    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      lines.push(`type ${entityName} struct {`);
      const keyField = entity.key || "id";
      if (!entity.fields[keyField] && !entity.embedded) {
        lines.push(`\t${this.toPascalCase(keyField)} string \`json:"${keyField},omitempty"\``);
      }

      for (const [fieldName, field] of Object.entries(entity.fields)) {
        const goName = this.toPascalCase(fieldName);
        const goType = this.mapFieldToGoType(entityName, fieldName, field);
        const omitempty = field.required ? "" : ",omitempty";
        lines.push(`\t${goName} ${goType} \`json:"${fieldName}${omitempty}"\``);
      }

      lines.push("}\n");
    }

    return lines.join("\n");
  }

  private static mapFieldToGoType(entityName: string, fieldName: string, field: FieldDefinition): string {
    switch (field.type) {
      case "string":
      case "email":
        return field.required ? "string" : "*string";
      case "int":
      case "integer":
        return field.required ? "int64" : "*int64";
      case "float":
        return field.required ? "float64" : "*float64";
      case "decimal":
        return field.required ? "decimal.Decimal" : "*decimal.Decimal";
      case "boolean":
      case "bool":
        return field.required ? "bool" : "*bool";
      case "date":
      case "datetime":
        return field.required ? "time.Time" : "*time.Time";
      case "enum":
        return `${entityName}${this.toPascalCase(fieldName)}`;
      case "ref":
        return "string";
      case "list":
        if (field.element) {
          if (field.element.type === "ref" && field.element.target) {
            return `[]${field.element.target}`;
          }
          return `[]${this.mapFieldToGoType(entityName, fieldName, field.element).replace("*", "")}`;
        }
        return "[]any";
      default:
        return "any";
    }
  }

  private static toPascalCase(str: string): string {
    if (!str) return "";
    return str
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter) => letter.toUpperCase())
      .replace(/[\s\-_]+/g, "");
  }
}
