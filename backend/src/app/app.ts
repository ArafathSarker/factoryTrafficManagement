import express from "express";
import cors from "cors";
import { appRouter } from "../routes/routes.js";
export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use("/api", appRouter);