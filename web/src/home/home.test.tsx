import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "../App";
import { MethodScreen } from "./MethodScreen";
import { isARSupported } from "../measure/xrAdapter";
import { getStrings } from "../i18n";

const noop = (): void => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home and method", () => {
  it("App opens on Home with the project card, offline banner and New project", () => {
    const t = getStrings("en");
    const html = renderToString(<App />);
    expect(html).toContain('data-testid="home-screen"');
    expect(html).toContain(t["home.start"]);
    expect(html).toContain(t["home.offline.title"]);
    expect(html).toContain(t["home.new"]);
    expect(html).toContain(t["notice.preliminary"]);
    expect(html).not.toContain(t["intake.upload.cta"]);
  });

  it("a seeded scene opens in the capture workspace", () => {
    const html = renderToString(<App initialScene={{ id: "s", walls: [] }} />);
    expect(html).not.toContain('data-testid="home-screen"');
  });

  it("method screen: photo is primary, draw/type are disabled with a Soon tag", () => {
    const t = getStrings("en");
    const html = renderToString(<MethodScreen locale="en" arSupported={false} onPhoto={noop} onAr={noop} />);
    expect(html).toContain(t["method.photo"]);
    expect(html).toContain(t["method.hint.title"]);
    expect(html.split(t["method.soon"]).length - 1).toBe(2);
    expect(html).not.toContain('data-method="ar"');
  });

  it("method screen shows the AR card only when AR is supported", () => {
    const html = renderToString(<MethodScreen locale="es-AR" arSupported={true} onPhoto={noop} onAr={noop} />);
    expect(html).toContain('data-method="ar"');
    expect(html).toContain(getStrings("es-AR")["method.ar"]);
  });

  it("isARSupported follows a mocked navigator.xr", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { xr: { isSessionSupported: async () => true } });
    expect(await isARSupported()).toBe(true);
    vi.stubGlobal("navigator", { xr: { isSessionSupported: async () => false } });
    expect(await isARSupported()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await isARSupported()).toBe(false);
  });
});

describe("Home offline copy", () => {
  it("states what works offline and what needs a connection, in both locales", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const t = getStrings(locale);
      expect(t["home.offline.body"]).toMatch(locale === "en" ? /assistant|AI/i : /asistente|IA/i);
      expect(t["home.offline.body"]).not.toMatch(locale === "en" ? /^No signal\? Keep editing\. Changes are saved/ : /^¿Sin señal\? Seguí editando\. Los cambios/);
    }
  });
});
