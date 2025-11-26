import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "payment-simple-allocation",
  configComponent: ConfigList,
});

export { ConfigList };
