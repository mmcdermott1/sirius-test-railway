import { Express, Request, Response, NextFunction } from "express";
import { addressValidationService, AddressInput } from "../services/address-validation";
import { z } from "zod";

// Middleware types
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;
type PermissionMiddleware = (permission: string) => (req: Request, res: Response, next: NextFunction) => void;

// Validation schema for address input
const addressInputSchema = z.object({
  street: z.string().min(1, "Street address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  postalCode: z.string().min(1, "Postal code is required"),
  country: z.string().min(1, "Country is required"),
});

export function registerAddressValidationRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // POST /api/addresses/validate - Validate an address
  app.post("/api/addresses/validate", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const addressData = addressInputSchema.parse(req.body);
      
      const result = await addressValidationService.validateAddress(addressData);
      
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid address data", 
          errors: error.errors.map(e => e.message) 
        });
      }
      
      console.error("Address validation error:", error);
      res.status(500).json({ message: "Failed to validate address" });
    }
  });

  // GET /api/addresses/validation-config - Get current validation configuration (admin only)
  app.get("/api/addresses/validation-config", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const config = await addressValidationService.getConfig();
      res.json(config);
    } catch (error) {
      console.error("Failed to get validation config:", error);
      res.status(500).json({ message: "Failed to get validation configuration" });
    }
  });

  // PUT /api/addresses/validation-config - Update validation configuration (admin only)
  app.put("/api/addresses/validation-config", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      await addressValidationService.updateConfig(req.body);
      const updatedConfig = await addressValidationService.getConfig();
      res.json(updatedConfig);
    } catch (error) {
      console.error("Failed to update validation config:", error);
      res.status(500).json({ message: "Failed to update validation configuration" });
    }
  });
}