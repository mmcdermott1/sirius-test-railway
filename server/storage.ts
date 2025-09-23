import { type User, type InsertUser, type Worker, type InsertWorker } from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Worker CRUD operations
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(worker: InsertWorker): Promise<Worker>;
  updateWorker(id: string, worker: Partial<InsertWorker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private workers: Map<string, Worker>;

  constructor() {
    this.users = new Map();
    this.workers = new Map();
    
    // Initialize with some sample workers
    this.initializeWorkers();
  }

  private async initializeWorkers() {
    const sampleWorkers = [
      { name: "John Smith" },
      { name: "Sarah Johnson" },
      { name: "Michael Chen" },
      { name: "Emma Wilson" },
      { name: "David Rodriguez" }
    ];

    for (const worker of sampleWorkers) {
      await this.createWorker(worker);
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAllWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    return this.workers.get(id);
  }

  async createWorker(insertWorker: InsertWorker): Promise<Worker> {
    const id = randomUUID();
    const worker: Worker = { ...insertWorker, id };
    this.workers.set(id, worker);
    return worker;
  }

  async updateWorker(id: string, workerUpdate: Partial<InsertWorker>): Promise<Worker | undefined> {
    const existingWorker = this.workers.get(id);
    if (!existingWorker) {
      return undefined;
    }

    const updatedWorker: Worker = { ...existingWorker, ...workerUpdate };
    this.workers.set(id, updatedWorker);
    return updatedWorker;
  }

  async deleteWorker(id: string): Promise<boolean> {
    return this.workers.delete(id);
  }
}

export const storage = new MemStorage();
