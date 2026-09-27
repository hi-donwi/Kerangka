import 'package:kerangka/kerangka.dart';
import 'package:test/test.dart';

void main() {
  final testDocument = <String, dynamic>{
    'kir': '0.1',
    'app': 'test-app',
    'entities': {
      'Invoice': {
        'fields': {
          'id': {'type': 'string', 'required': true},
          'status': {
            'type': 'enum',
            'values': ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID'],
            'default': 'DRAFT',
          },
          'total': {
            'type': 'number',
            'compute': {
              'type': 'call',
              'func': 'sum',
              'args': [
                {'type': 'ref', 'name': 'items'},
                {'type': 'call', 'func': 'mul', 'args': ['qty', 'unitPrice']},
              ],
            },
          },
        },
        'workflow': {
          'field': 'status',
          'initial': 'DRAFT',
          'transitions': {
            'submit': {
              'from': ['DRAFT'],
              'to': 'SUBMITTED',
              'roles': ['editor', 'admin'],
              'then': [
                {'emit': 'InvoiceSubmitted', 'data': {'target': 'id'}},
                {'set': {'submittedAt': 'now()'}},
              ],
            },
            'approve': {
              'from': 'SUBMITTED',
              'to': 'APPROVED',
              'roles': ['approver', 'admin'],
            },
          },
        },
      },
    },
  };

  group('ReferenceEngine Dart Tests', () {
    late ReferenceEngine engine;

    setUp(() {
      engine = ReferenceEngine(testDocument);
    });

    test('compute materializes defaults and aggregate sum', () {
      final record = <String, dynamic>{
        'id': 'inv-001',
        'items': [
          {'qty': 2, 'unitPrice': 50},
          {'qty': 3, 'unitPrice': 100},
        ],
      };

      final computed = engine.compute('Invoice', record);
      expect(computed['status'], equals('DRAFT'));
      expect(computed['total'], equals(400));
    });

    test('validate verifies required fields and enum values', () {
      final validRecord = <String, dynamic>{
        'id': 'inv-001',
        'status': 'DRAFT',
      };
      final validRes = engine.validate('Invoice', validRecord);
      expect(validRes.valid, isTrue);
      expect(validRes.errors, isEmpty);

      final invalidRecord = <String, dynamic>{
        'status': 'NON_EXISTENT_STATE',
      };
      final invalidRes = engine.validate('Invoice', invalidRecord);
      expect(invalidRes.valid, isFalse);
      expect(invalidRes.errors.length, equals(2));
      expect(invalidRes.errors.any((e) => e.code == 'REQUIRED_FIELD'), isTrue);
      expect(invalidRes.errors.any((e) => e.code == 'INVALID_ENUM'), isTrue);
    });

    test('transition executes valid state transitions and checks permissions', () {
      final record = <String, dynamic>{
        'id': 'inv-001',
        'status': 'DRAFT',
      };

      // Denied due to lack of role
      final deniedRes = engine.transition(
        'Invoice',
        record,
        'submit',
        actorRoles: ['guest'],
      );
      expect(deniedRes.ok, isFalse);
      expect(deniedRes.error, equals('PERMISSION_DENIED'));

      // Successful submit
      final okRes = engine.transition(
        'Invoice',
        record,
        'submit',
        actorRoles: ['editor'],
      );
      expect(okRes.ok, isTrue);
      expect(okRes.record?['status'], equals('SUBMITTED'));
      expect(okRes.record?['submittedAt'], isNotNull);
      expect(okRes.events.length, equals(1));
      expect(okRes.events[0]['name'], equals('InvoiceSubmitted'));

      // Illegal transition from current state
      final illegalRes = engine.transition(
        'Invoice',
        okRes.record!,
        'submit',
        actorRoles: ['editor'],
      );
      expect(illegalRes.ok, isFalse);
      expect(illegalRes.error, equals('INVALID_STATE_TRANSITION'));
    });
  });
}
