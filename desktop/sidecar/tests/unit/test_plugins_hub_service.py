from pathlib import Path

from daemon.services import plugins_hub


def test_get_plugins_hub_accepts_keyed_plugin_entries(monkeypatch, tmp_path):
    plugin_dir = tmp_path / "bundled" / "observability" / "nemo_relay"
    plugin_dir.mkdir(parents=True)

    monkeypatch.setattr(plugins_hub, "_get_dashboard_plugins", lambda force_rescan=False: [])
    monkeypatch.setattr(plugins_hub, "_get_hermes_home", lambda: tmp_path / "home")

    import hermes_cli.config as config
    import hermes_cli.plugins_cmd as plugins_cmd

    monkeypatch.setattr(config, "load_config", lambda: {})
    monkeypatch.setattr(plugins_cmd, "_get_enabled_set", lambda: {"observability/nemo_relay"})
    monkeypatch.setattr(plugins_cmd, "_get_disabled_set", lambda: set())
    monkeypatch.setattr(
        plugins_cmd,
        "_discover_all_plugins",
        lambda: [
            (
                "nemo_relay",
                "1.2.3",
                "Nested observability plugin",
                "bundled",
                Path(plugin_dir),
                "observability/nemo_relay",
            )
        ],
    )
    monkeypatch.setattr(plugins_cmd, "_read_manifest", lambda _path: {})
    monkeypatch.setattr(plugins_cmd, "_discover_memory_providers", lambda: [])
    monkeypatch.setattr(plugins_cmd, "_discover_context_engines", lambda: [])
    monkeypatch.setattr(plugins_cmd, "_get_current_memory_provider", lambda: "")
    monkeypatch.setattr(plugins_cmd, "_get_current_context_engine", lambda: None)

    hub = plugins_hub.get_plugins_hub()

    assert hub["plugins"][0]["name"] == "nemo_relay"
    assert hub["plugins"][0]["runtime_status"] == "enabled"
