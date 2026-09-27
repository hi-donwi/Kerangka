# Kerangka Semantics: Numbers and Arithmetic

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Core Principle: Zero Floating Point Tolerance

In business software (invoicing, payroll, currency exchange, inventory counting), floating point approximation (`0.1 + 0.2 = 0.30000000000000004`) causes severe calculation discrepancies, audit failures, and data corruption.

Kerangka **prohibits IEEE 754 floating point arithmetic** for business calculations across all Tier 1 engines.

## 2. Decimals

### 2.1 Representation
- All decimal numbers are represented as **exact fixed-point numbers**.
- Wire representation in JSON payloads is strictly a **string** (`"1250.50"`), preventing float conversion by native JSON parsers.
- Maximum precision is capped at **28 total digits** (matching SQL standard `decimal(28, s)` and IEEE 754-2008 decimal128).

### 2.2 Rounding Mode: `HALF_EVEN`
All rounding operations must use **Banker's Rounding (`HALF_EVEN`)**:
- Rounds toward the nearest neighbor, unless both neighbors are equidistant, in which case it rounds to the nearest even digit.
- Example with 2 decimal places:
  - `2.545` -> `2.54`
  - `2.555` -> `2.56`
  - `2.565` -> `2.56`

### 2.3 Division and Division by Zero
- Division specifies a target scale. If unspecified, the result adopts the maximum scale of the operands plus 4.
- In expression context, division by zero (`x / 0`) evaluates to `null` to avoid throwing unexpected unhandled exceptions in UI bindings.
- In validation rules or action guards, division by zero is rejected with error code `DIVIDE_BY_ZERO`.

## 3. Integers

- Integers represent whole counts, sequencing, and quantities.
- Default integer type is signed 64-bit integer (`-9,223,372,036,854,775,808` to `9,223,372,036,854,775,807`).
- In environments with standard IEEE 754 numbers (like JavaScript V8), values exceeding `Number.MAX_SAFE_INTEGER` (`9,007,199,254,740,991`) are represented as `BigInt` or strings.
