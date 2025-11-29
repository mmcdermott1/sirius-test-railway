export { DatabaseStorage, type IStorage, storage } from "./database";
export { type VariableStorage, createVariableStorage } from "./variables";
export { type UserStorage, createUserStorage } from "./users";
export { type CommStorage, type CommSmsStorage, type CommSmsOptinStorage, type CommEmailStorage, type CommWithSms, type CommWithDetails, type CommSmsWithComm, createCommStorage, createCommSmsStorage, createCommSmsOptinStorage, createCommEmailStorage } from "./comm";
