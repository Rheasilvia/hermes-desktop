import { Component, createSignal, onMount } from "solid-js";
import { type as osType } from "@tauri-apps/plugin-os";
import { getCurrentWindow } from "@tauri-apps/api/window";
import styles from "./TitleBar.module.css";
import iconSvg from "@/assets/nousresearch.svg?raw";

export const TitleBar: Component = () => {
  const [platform, setPlatform] = createSignal<string>("unknown");

  onMount(async () => {
    try {
      const t = await osType();
      setPlatform(t);
    } catch {
      setPlatform("unknown");
    }
  });

  const isMac = () => platform() === "macos";

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleMaximize = () => {
    getCurrentWindow().toggleMaximize();
  };

  const iconMarkup = () =>
    iconSvg
      .replace(/<title>.*?<\/title>/, "")
      .replace('height="1em"', 'height="16"')
      .replace('width="1em"', 'width="16"')
      .replace('style="flex:none;line-height:1"', "");

  return (
    <div class={styles.titleBar} data-tauri-drag-region>
      <div class={styles.left}>
        {isMac() && (
          <div class={styles.trafficLights}>
            <button
              class={styles.close + " " + styles.dot}
              onClick={handleClose}
              aria-label="Close"
              type="button"
            />
            <button
              class={styles.minimize + " " + styles.dot}
              onClick={handleMinimize}
              aria-label="Minimize"
              type="button"
            />
            <button
              class={styles.maximize + " " + styles.dot}
              onClick={handleMaximize}
              aria-label="Maximize"
              type="button"
            />
          </div>
        )}
      </div>
      <div class={styles.center} data-tauri-drag-region>
        <span class={styles.brand}>
          <span innerHTML={iconMarkup()} aria-hidden="true" />
          <span class={styles.title}>Hermes</span>
        </span>
      </div>
      <div class={styles.right} />
    </div>
  );
};
