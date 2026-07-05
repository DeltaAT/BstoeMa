import { AnnouncementStore } from "./announcement-store";
import { AuthStore } from "./auth-store";
import { ConfigStore } from "./config-store";
import { EventBackupStore } from "./event-backup-store";
import { EventStore } from "./event-store";
import { MenuStore } from "./menu-store";
import { OrderStore } from "./order-store";
import { OrderDisplayStore } from "./order-display-store";
import { PrinterStore } from "./printer-store";
import { StockStore } from "./stock-store";
import { TableStore } from "./table-store";
import { UserStore } from "./user-store";

export const eventStore = new EventStore();
export const eventBackupStore = new EventBackupStore(eventStore);
export const announcementStore = new AnnouncementStore(eventStore);
export const configStore = new ConfigStore(eventStore);
export const userStore = new UserStore(eventStore);
export const authStore = new AuthStore(eventStore, userStore);
export const menuStore = new MenuStore(eventStore);
export const orderStore = new OrderStore(eventStore);
export const orderDisplayStore = new OrderDisplayStore(eventStore);
export const printerStore = new PrinterStore(eventStore);
export const stockStore = new StockStore(eventStore);
export const tableStore = new TableStore(eventStore);

