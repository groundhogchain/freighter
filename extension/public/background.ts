import {
  initContentScriptMessageListener,
  initExtensionMessageListener,
  initInstalledListener,
  initAlarmListener,
  initSidebarBehavior,
  initSidebarConnectionListener,
} from "background";
import { initThruputLifecycle } from "background/thruput/service";

function main() {
  initThruputLifecycle();
  initContentScriptMessageListener();
  initExtensionMessageListener();
  initInstalledListener();
  initAlarmListener();
  initSidebarBehavior();
  initSidebarConnectionListener();
}

main();
