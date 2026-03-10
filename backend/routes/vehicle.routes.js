<<<<<<< HEAD
// Vehicle routes
import express from "express";
import { getVehicleById, getVehicles } from "../controllers/vehicle.controller.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";
=======
<<<<<<< HEAD
import express from "express";
import { getVehicles } from "../controllers/vehicle.controller.js";
=======
// Vehicle routes
import express from "express";
import { getVehicleById, getVehicles } from "../controllers/vehicle.controller.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

const router = express.Router();

router.get("/", getVehicles);
<<<<<<< HEAD
router.get("/:id", validateObjectIdParam("id"), getVehicleById);
=======
<<<<<<< HEAD
=======
router.get("/:id", validateObjectIdParam("id"), getVehicleById);
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

export default router;
