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

  Map<String, dynamic> guarded(Object when) => {
        'kir': '0.1',
        'app': 'guards',
        'entities': {
          'Invoice': {
            'fields': {
              'status': {'type': 'enum', 'values': ['draft', 'sent']},
            },
            'workflow': {
              'field': 'status',
              'transitions': {
                'send': {'from': 'draft', 'to': 'sent', 'when': when},
              },
            },
          },
        },
      };

  // An operator outside the subset must refuse the transition rather than skip it (ADR-0008).
  test('an unsupported guard is refused, not skipped', () {
    final result = ReferenceEngine(guarded({r'$expr': 'today', 'args': []}))
        .transition('Invoice', {'status': 'draft'}, 'send');
    expect(result.ok, isFalse);
    expect(result.error, equals('GUARD_UNSUPPORTED'));
  });

  test('a true comparison guard allows the transition', () {
    final result = ReferenceEngine(guarded({
      r'$expr': '==',
      'args': [
        {r'$bind': 'status'},
        {'literal': 'draft'},
      ],
    })).transition('Invoice', {'status': 'draft'}, 'send');
    expect(result.ok, isTrue);
    expect(result.record?['status'], equals('sent'));
  });

  test('a conjunction guard allows the transition', () {
    final result = ReferenceEngine(guarded({
      r'$expr': '&&',
      'args': [
        {
          r'$expr': '==',
          'args': [
            {r'$bind': 'status'},
            {'literal': 'draft'},
          ],
        },
        {
          r'$expr': '!=',
          'args': [
            {r'$bind': 'status'},
            {'literal': 'sent'},
          ],
        },
      ],
    })).transition('Invoice', {'status': 'draft'}, 'send');
    expect(result.ok, isTrue);
  });

  test('a false comparison guard does not run the transition', () {
    final result = ReferenceEngine(guarded({
      r'$expr': '==',
      'args': [
        {r'$bind': 'status'},
        {'literal': 'sent'},
      ],
    })).transition('Invoice', {'status': 'draft'}, 'send');
    expect(result.ok, isFalse);
    expect(result.error, equals('GUARD_FAILED'));
  });

  group('Permissions and canOperate', () {
    final doc = {
      'kir': '0.1',
      'app': 'perms-test',
      'entities': {
        'Invoice': {
          'fields': {
            'status': {'type': 'enum', 'values': ['draft', 'sent']},
            'ownerId': {'type': 'string'},
            'total': {'type': 'decimal'},
          },
          'permissions': {
            'read': ['admin', 'billing', 'viewer'],
            'create': ['admin', 'billing'],
            'update': {
              'admin': true,
              'billing': "status == 'draft'",
              'owner': 'ownerId == actor.id',
              'viewer': false,
            },
            'delete': [],
          },
        },
        'PublicDoc': {
          'fields': {'id': {'type': 'string'}},
        },
      },
    };
    final engine = ReferenceEngine(doc);
    final admin = {'id': 'u-admin', 'roles': ['admin']};
    final billing = {'id': 'u-billing', 'roles': ['billing']};
    final viewer = {'id': 'u-viewer', 'roles': ['viewer']};
    final owner = {'id': 'u-owner-1', 'roles': ['owner']};

    test('unlisted operation is open', () {
      final dec = engine.canOperate('Invoice', 'archive', actor: viewer);
      expect(dec.allowed, isTrue);
    });

    test('empty list grants no one', () {
      final dec = engine.canOperate('Invoice', 'delete', actor: admin);
      expect(dec.allowed, isFalse);
      expect(dec.code, equals('PERMISSION_DENIED'));
    });

    test('unknown entity refused', () {
      final dec = engine.canOperate('Unknown', 'read', actor: admin);
      expect(dec.allowed, isFalse);
      expect(dec.code, equals('UNKNOWN_ENTITY'));
    });

    test('role mapped to true allows with or without record', () {
      final dec = engine.canOperate('Invoice', 'update', actor: admin);
      expect(dec.allowed, isTrue);
      final decRec = engine.canOperate('Invoice', 'update', actor: admin, record: {'status': 'sent'});
      expect(decRec.allowed, isTrue);
    });

    test('role mapped to false refused', () {
      final dec = engine.canOperate('Invoice', 'update', actor: viewer, record: {'status': 'draft'});
      expect(dec.allowed, isFalse);
      expect(dec.code, equals('PERMISSION_DENIED'));
    });

    test('conditional grant without record returns needs record', () {
      final dec = engine.canOperate('Invoice', 'update', actor: billing);
      expect(dec.allowed, isFalse);
      expect(dec.code, equals('PERMISSION_NEEDS_RECORD'));
    });

    test('conditional grant with matching record allows', () {
      final dec = engine.canOperate('Invoice', 'update', actor: billing, record: {'status': 'draft'});
      expect(dec.allowed, isTrue);
    });

    test('conditional grant with non-matching record denies', () {
      final dec = engine.canOperate('Invoice', 'update', actor: billing, record: {'status': 'sent'});
      expect(dec.allowed, isFalse);
      expect(dec.code, equals('PERMISSION_DENIED'));
    });

    test('actor context matching in condition', () {
      final dec = engine.canOperate('Invoice', 'update', actor: owner, record: {'status': 'sent', 'ownerId': 'u-owner-1'});
      expect(dec.allowed, isTrue);
      final decOther = engine.canOperate('Invoice', 'update', actor: owner, record: {'status': 'sent', 'ownerId': 'u-other'});
      expect(decOther.allowed, isFalse);
      expect(decOther.code, equals('PERMISSION_DENIED'));
    });
  });

  group('AuthorizeRead and ReadFilter', () {
    final doc = {
      'kir': '0.1',
      'app': 'rf-test',
      'entities': {
        'Public': {
          'fields': {'id': {'type': 'string'}},
        },
        'Scoped': {
          'fields': {'tenantId': {'type': 'string'}},
        },
        'SoftDeleted': {
          'fields': {'deleted': {'type': 'boolean'}},
        },
        'Doc': {
          'fields': {'tenantId': {'type': 'string'}},
          'readFilter': ['==', ['get', 'ownerId'], ['actor', 'id']],
        },
        'BrokenDoc': {
          'fields': {'tenantId': {'type': 'string'}},
          'readFilter': "status == 'draft'",
        },
      },
    };
    final engine = ReferenceEngine(doc);
    final adminTenant = {'id': 'u-1', 'tenantId': 'tenant-a', 'roles': ['admin']};
    final adminNoTenant = {'id': 'u-1', 'roles': ['admin']};

    test('public entity allows without constraint', () {
      final scope = engine.authorizeRead('Public');
      expect(scope.allowed, isTrue);
      expect(scope.where, isNull);
    });

    test('unknown entity refused', () {
      final scope = engine.authorizeRead('Unknown');
      expect(scope.allowed, isFalse);
      expect(scope.code, equals('UNKNOWN_ENTITY'));
    });

    test('scoped without tenant denied', () {
      final scope = engine.authorizeRead('Scoped', adminNoTenant);
      expect(scope.allowed, isFalse);
      expect(scope.code, equals('PERMISSION_DENIED'));
    });

    test('scoped with tenant allowed', () {
      final scope = engine.authorizeRead('Scoped', adminTenant);
      expect(scope.allowed, isTrue);
      expect(scope.where, equals(['==', ['get', 'tenantId'], 'tenant-a']));
    });

    test('soft deleted adds condition', () {
      final scope = engine.authorizeRead('SoftDeleted');
      expect(scope.allowed, isTrue);
      expect(scope.where, equals(['==', ['get', 'deleted'], false]));
    });

    test('uncompiled string readFilter refused', () {
      final scope = engine.authorizeRead('BrokenDoc', adminTenant);
      expect(scope.allowed, isFalse);
      expect(scope.code, equals('READ_FILTER_NOT_COMPILED'));
    });

    test('combined readFilter and evalFilter', () {
      final scope = engine.authorizeRead('Doc', adminTenant);
      expect(scope.allowed, isTrue);
      expect((scope.where as List)[0], equals('and'));

      expect(engine.evalFilter(scope.where, {'tenantId': 'tenant-a', 'ownerId': 'u-1'}, adminTenant), isTrue);
      expect(engine.evalFilter(scope.where, {'tenantId': 'tenant-b', 'ownerId': 'u-1'}, adminTenant), isFalse);
      expect(engine.evalFilter(scope.where, {'tenantId': 'tenant-a', 'ownerId': 'u-2'}, adminTenant), isFalse);
    });
  });

  group('Decision Tables', () {
    final doc = {
      'kir': '0.1',
      'app': 'routing',
      'decisions': {
        'approverRouting': {
          'hitPolicy': 'first',
          'inputs': [
            {'name': 'days', 'type': 'int'}
          ],
          'outputs': [
            {'name': 'approverRole', 'type': 'string'}
          ],
          'rows': [
            {'days': '<= 2', 'approverRole': 'team-lead'},
            {'days': '<= 5', 'approverRole': 'department-manager'},
            {'days': '> 5', 'approverRole': 'hr-director'},
          ],
        },
        'uniquePolicy': {
          'hitPolicy': 'unique',
          'inputs': [
            {'name': 'code', 'type': 'string'}
          ],
          'outputs': [
            {'name': 'label', 'type': 'string'}
          ],
          'rules': [
            {
              'inputs': ['A'],
              'outputs': {'label': 'Active'}
            },
            {
              'inputs': ['A'],
              'outputs': {'label': 'Alternate'}
            },
          ],
        },
        'featureFlags': {
          'hitPolicy': 'collect',
          'inputs': [
            {'name': 'role', 'type': 'string'}
          ],
          'outputs': [
            {'name': 'feature', 'type': 'string'}
          ],
          'rules': [
            {
              'inputs': ['admin'],
              'outputs': {'feature': 'export_csv'}
            },
            {
              'inputs': ['admin'],
              'outputs': {'feature': 'manage_users'}
            },
            {
              'inputs': ['user'],
              'outputs': {'feature': 'read_only'}
            },
          ],
        },
      },
      'entities': {
        'LeaveRequest': {
          'key': 'id',
          'fields': {
            'days': {'type': 'int'},
            'approverRole': {
              'type': 'string',
              'compute': 'approverRouting(days)',
            },
          },
        },
      },
    };

    final engine = ReferenceEngine(doc);

    test('first hit policy with canonical rows', () {
      final short = engine.decide('approverRouting', {'days': 2});
      expect(short.matched, isTrue);
      expect(short.outputs, equals({'approverRole': 'team-lead'}));

      final med = engine.decide('approverRouting', {'days': 4});
      expect(med.outputs, equals({'approverRole': 'department-manager'}));

      final longReq = engine.decide('approverRouting', {'days': 9});
      expect(longReq.outputs, equals({'approverRole': 'hr-director'}));
    });

    test('compute with decision table', () {
      final computed = engine.compute('LeaveRequest', {'days': 4});
      expect(computed['approverRole'], equals('department-manager'));
    });

    test('unique hit policy violation', () {
      final res = engine.decide('uniquePolicy', {'code': 'A'});
      expect(res.matched, isFalse);
      expect(res.code, equals('UNIQUE_VIOLATION'));
    });

    test('collect hit policy', () {
      final res = engine.decide('featureFlags', {'role': 'admin'});
      expect(res.matched, isTrue);
      expect(res.hitCount, equals(2));
      expect((res.outputs as List).length, equals(2));
    });

    test('no match fails closed', () {
      final res = engine.decide('approverRouting', {'days': 'invalid'});
      expect(res.matched, isFalse);
      expect(res.code, equals('DECISION_NO_MATCH'));
    });

    test('table not found', () {
      final res = engine.decide('nonExistent', {});
      expect(res.matched, isFalse);
      expect(res.code, equals('TABLE_NOT_FOUND'));
    });
  });

  group('Decimal Wire Decoding', () {
    final doc = {
      'kir': '0.1',
      'app': 'store',
      'entities': {
        'Product': {
          'key': 'sku',
          'fields': {
            'sku': {'type': 'string'},
            'price': {'type': 'decimal'},
          },
        },
      },
    };

    final engine = ReferenceEngine(doc);

    test('decodeRecord valid decimal string', () {
      final decoded = engine.decodeRecord('Product', {'sku': 'SKU-1', 'price': '150.00'});
      expect(decoded['price'], equals(150.0));
      expect(decoded['price'] is num, isTrue);
    });

    test('decodeRecord negative decimal string', () {
      final decoded = engine.decodeRecord('Product', {'sku': 'SKU-2', 'price': '-5.50'});
      expect(decoded['price'], equals(-5.5));
    });

    test('validation fails on invalid decimal', () {
      final valRes = engine.validate('Product', {'sku': 'SKU-3', 'price': 'not-a-decimal'});
      expect(valRes.valid, isFalse);
      expect(valRes.errors.any((e) => e.code == 'INVALID_DECIMAL'), isTrue);
    });
  });

  group('Built-in Functions', () {
    dynamic evaluate(List<dynamic> tuple) {
      final res = evalNode(tuple);
      expect(res.supported, isTrue);
      return res.value;
    }

    test('evaluates built-in math, string, and utility functions', () {
      expect(evaluate(['abs', -42.0]), equals(42.0));
      expect(evaluate(['round', 3.14159, 2]), equals(3.14));
      expect(evaluate(['min', 10.0, 20.0]), equals(10.0));
      expect(evaluate(['max', 10.0, 20.0]), equals(20.0));
      expect(evaluate(['lower', 'HELLO']), equals('hello'));
      expect(evaluate(['upper', 'world']), equals('WORLD'));
      expect(evaluate(['trim', '  hello  ']), equals('hello'));
      expect(evaluate(['len', 'hello']), equals(5));
      expect(evaluate(['contains', 'kerangka', 'rang']), isTrue);
      expect(evaluate(['startsWith', 'kerangka', 'ker']), isTrue);
      expect(evaluate(['concat', 'foo', 'bar', 'baz']), equals('foobarbaz'));
      expect(evaluate(['coalesce', null, null, 'first']), equals('first'));
    });
  });
}



