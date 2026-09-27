/**
 * Kerangka Java 21 Record Code Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { FieldDefinition, KIRDocument } from "../types.js";

export class JavaCodegen {
  static generate(kir: KIRDocument, packageName: string = "com.kerangka.model"): string {
    const lines: string[] = [
      `package ${packageName};`,
      "",
      "import java.math.BigDecimal;",
      "import java.time.LocalDate;",
      "import java.time.Instant;",
      "import java.util.List;",
      "import java.util.Optional;",
      ""
    ];

    // Enums
    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      for (const [fieldName, field] of Object.entries(entity.fields)) {
        if (field.type === "enum" && field.values && field.values.length > 0) {
          const enumName = `${entityName}${this.capitalize(fieldName)}`;
          lines.push(`public enum ${enumName} {`);
          lines.push(`    ${field.values.map(v => v.toUpperCase()).join(", ")}`);
          lines.push("}\n");
        }
      }
    }

    // Java 21 Records
    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      lines.push(`public record ${entityName}(`);
      const recordFields: string[] = [];

      const keyField = entity.key || "id";
      if (!entity.fields[keyField] && !entity.embedded) {
        recordFields.push(`    String ${keyField}`);
      }

      for (const [fieldName, field] of Object.entries(entity.fields)) {
        const javaType = this.mapFieldToJavaType(entityName, fieldName, field);
        recordFields.push(`    ${javaType} ${fieldName}`);
      }

      lines.push(recordFields.join(",\n"));
      lines.push(") {}\n");
    }

    return lines.join("\n");
  }

  private static mapFieldToJavaType(entityName: string, fieldName: string, field: FieldDefinition): string {
    switch (field.type) {
      case "string":
      case "email":
        return "String";
      case "int":
      case "integer":
        return "Integer";
      case "float":
        return "Double";
      case "decimal":
        return "BigDecimal";
      case "boolean":
      case "bool":
        return "Boolean";
      case "date":
        return "LocalDate";
      case "datetime":
        return "Instant";
      case "enum":
        return `${entityName}${this.capitalize(fieldName)}`;
      case "ref":
        return field.target ? "String" : "String";
      case "list":
        if (field.element) {
          if (field.element.type === "ref" && field.element.target) {
            return `List<${field.element.target}>`;
          }
          return `List<${this.mapFieldToJavaType(entityName, fieldName, field.element)}>`;
        }
        return "List<Object>";
      default:
        return "Object";
    }
  }

  private static capitalize(str: string): string {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
