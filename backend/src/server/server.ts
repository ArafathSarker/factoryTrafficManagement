import { app } from "../app/app.js";
import "dotenv/config";
import { runScheduler } from "../services/scheduler.js";

const port = Number(process.env.PORT) || 8080;
const hostName = process.env.HOST_NAME || "localhost";
app.listen(port, (err) => {
    if (err) console.log("Error:", err);
    else {
        console.log(`server:https://${hostName}:${port}`);
        runScheduler();
    }
})
