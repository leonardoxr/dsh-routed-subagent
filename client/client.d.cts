__ModuleLoader__.load({ id: "dsh-routed-subagent", factory: function (require, module, exports) {
//#region src/client/index.d.ts
/** The client cordis context shape this plugin relies on. */
interface RoutedClientContext {
  effect(callback: () => unknown, label?: string): void;
  locale: {
    register(namespace: string, dicts: {
      zh: Record<string, string>;
      en: Record<string, string>;
    }): unknown;
    bind(namespace: string): (key: string) => string;
  };
  slots: {
    inject(slot: string, register: () => unknown): void;
    register(meta: Record<string, unknown>, component: () => unknown): unknown;
  };
}
declare const name = "routed-subagent";
declare const inject: string[];
/**
 * Mount the browser half: dictionaries plus the keyed card into
 * `settings.plugin.item`. The settingsScope injection is nested so a host
 * without the plugin-configuration page simply never renders the card.
 * @param ctx - the browser plugin context.
 */
declare function apply(ctx: RoutedClientContext): void;
//#endregion
export { apply, inject, name };
return module.exports; } });