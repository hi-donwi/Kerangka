# @kerangka/dart — Dart & Flutter SDK

Pure reference execution engine and SDK for Kerangka models in Dart and Flutter applications.

## Features

- **Pure in-memory engine:** Zero external dependencies at runtime.
- **Computed fields:** Materializes reactive computed expressions and defaults.
- **Invariant validation:** Validates required fields, types, and enum invariants.
- **Workflow transitions:** Deterministic state machine execution with role enforcement and side effects.

## Usage

```dart
import 'package:kerangka/kerangka.dart';

void main() {
  final kirDoc = <String, dynamic>{
    // ... KIR document JSON ...
  };

  final engine = ReferenceEngine(kirDoc);
  final result = engine.compute('Invoice', {'id': 'inv-1'});
}
```

## License

Apache-2.0
