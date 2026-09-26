import 'dart:convert';

import 'package:anx_reader/config/shared_preference_provider.dart';import 'package:anx_reader/enums/ai_reasoning_effort.dart';
import 'package:anx_reader/l10n/generated/L10n.dart';
import 'package:anx_reader/models/ai_provider.dart';
import 'package:anx_reader/page/settings_page/ai.dart';
import 'package:anx_reader/providers/ai_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> resetPrefs() async {
  SharedPreferences.setMockInitialValues({});
  await Prefs().initPrefs();
}

void main() {
  testWidgets('the AI settings page builds its body', (tester) async {
    await resetPrefs();
    // Tall enough that the whole page is laid out at once.
    tester.view.physicalSize = const Size(1000, 6000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          localizationsDelegates: L10n.localizationsDelegates,
          supportedLocales: L10n.supportedLocales,
          home: const Scaffold(body: AISettings()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AISettings), findsOneWidget);
    // Every section header has to be on screen; a build that throws paints the
    // whole body as one plain box instead.
    final l10n = L10n.of(tester.element(find.byType(AISettings)));
    expect(tester.takeException(), isNull);
    expect(find.text(l10n.settingsAiServices), findsOneWidget);
    expect(find.text(l10n.settingsAiPrompt), findsOneWidget);
    expect(find.text(l10n.settingsAiTools), findsOneWidget);
    // The provider row reads the selected provider, which is what used to throw.
    expect(find.text(l10n.settingsAiProviders), findsOneWidget);
  });

  testWidgets('the provider list survives an empty storage', (tester) async {
    await resetPrefs();

    final container = ProviderContainer();
    addTearDown(container.dispose);
    final providers = container.read(aiProvidersProvider);

    expect(providers, isNotEmpty);
    expect(Prefs().getAiProviders(), hasLength(providers.length));
  });

  test('AiProvider serialises to the shape it parses', () async {
    await resetPrefs();

    final provider = AiProvider(
      id: 'provider-1',
      title: 'My Provider',
      logoAsset: 'assets/logo.png',
      url: 'https://example.test/v1',
      protocol: AiProtocol.claude,
      enabled: false,
      isBuiltin: true,
      apiKeys: [
        AiApiKey(
          id: 'key-1',
          key: 'secret',
          enabled: false,
          label: 'work',
          createdAt: DateTime.utc(2026, 1, 2, 3, 4, 5),
        ),
      ],
      model: 'claude-x',
      reasoningEffort: AiReasoningEffort.high,
      keyIndex: 2,
      createdAt: DateTime.utc(2026, 1, 2, 3, 4, 5),
      updatedAt: DateTime.utc(2026, 2, 3, 4, 5, 6),
    );

    // Through a real string, as the preferences store does.
    final restored = AiProvider.fromJson(
      Map<String, dynamic>.from(
        jsonDecode(jsonEncode(provider.toJson())) as Map,
      ),
    );

    expect(restored, provider);
    Prefs().saveAiProviders([provider]);
    expect(Prefs().getAiProviders(), hasLength(1));
    expect(
      AiProvider.fromJson(
        Map<String, dynamic>.from(Prefs().getAiProviders().first as Map),
      ),
      provider,
    );
  });
}
