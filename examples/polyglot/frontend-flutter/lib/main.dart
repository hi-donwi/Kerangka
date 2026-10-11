import 'package:flutter/material.dart';
import 'package:uidl_flutter/uidl_flutter.dart';
import 'models.dart';

void main() {
  runApp(const PolyglotTasksApp());
}

class PolyglotTasksApp extends StatelessWidget {
  const PolyglotTasksApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Polyglot Task Hub',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: const Scaffold(
        body: SafeArea(
          child: UIDLScreen(assetPath: 'frontend-screens/task-list.uidl.json'),
        ),
      ),
    );
  }
}
