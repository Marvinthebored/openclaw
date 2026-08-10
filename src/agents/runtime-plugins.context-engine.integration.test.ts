// Verifies prepared agent turns retain runtime context-engine registrations from Gateway startup.
import { afterAll, afterEach, expect, it } from "vitest";
import { loadAndActivateRootPluginRegistry } from "../plugins/loader.js";
import {
  cleanupPluginLoaderFixturesForTest,
  makeTempDir,
  resetPluginLoaderTestStateForTest,
  useNoBundledPlugins,
  writePlugin,
} from "../plugins/loader.test-fixtures.js";
import { withPluginRuntimeRegistryScope } from "../plugins/runtime/gateway-request-scope.js";
import { createContextEngineLogicalTurnLease } from "./harness/context-engine-logical-turn.js";
import { loadAgentRuntimePluginRegistryHandle } from "./runtime-plugins.js";

afterEach(() => {
  resetPluginLoaderTestStateForTest();
});

afterAll(() => {
  cleanupPluginLoaderFixturesForTest();
});

it("keeps the configured context engine active in a prepared turn", async () => {
  useNoBundledPlugins();
  const engineId = "prepared-context-engine";
  const extraPluginId = "prepared-extra-plugin";
  const plugin = writePlugin({
    id: engineId,
    body: `module.exports = {
      id: ${JSON.stringify(engineId)},
      register(api) {
        api.registerContextEngine(${JSON.stringify(engineId)}, () => ({
          info: { id: ${JSON.stringify(engineId)}, name: "Prepared Context Engine" },
          async ingest() { return { ingested: false }; },
          async assemble({ messages }) { return { messages, estimatedTokens: 0 }; },
          async compact() { return { ok: true, compacted: false }; },
        }));
      },
    };\n`,
  });
  const extraPlugin = writePlugin({
    id: extraPluginId,
    body: `module.exports = { id: ${JSON.stringify(extraPluginId)}, register() {} };\n`,
  });
  const config = {
    plugins: {
      allow: [engineId, extraPluginId],
      load: { paths: [plugin.file, extraPlugin.file] },
      entries: {
        [engineId]: { enabled: true },
        [extraPluginId]: { enabled: true },
      },
      slots: { contextEngine: engineId },
    },
  };

  const activeRegistry = loadAndActivateRootPluginRegistry({
    cache: false,
    config,
    workspaceDir: makeTempDir(),
    onlyPluginIds: [engineId],
  });
  const preparedRegistry = loadAgentRuntimePluginRegistryHandle({
    basePluginIds: [engineId, extraPluginId],
    config,
    workspaceDir: makeTempDir(),
  });

  expect(preparedRegistry).not.toBe(activeRegistry);
  expect(preparedRegistry.plugins.some((entry) => entry.id === extraPluginId)).toBe(true);
  await withPluginRuntimeRegistryScope(preparedRegistry, async () => {
    const lease = await createContextEngineLogicalTurnLease({ config, workspaceDir: plugin.dir });
    expect(lease.degraded).toBe(false);
    expect(lease.effectiveEngineId).toBe(engineId);
    await lease.dispose();
  });
});
