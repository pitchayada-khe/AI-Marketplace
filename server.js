const express = require("express");
const app = express();

app.use(express.json());

const handheldRoutes = require("./handheld");
const outboundRoutes = require("./outboundTransfers");
const inboundRoutes = require("./inboundApprovals");
const driverAssignmentsRoutes = require("./driverAssignments");
const mlMarketplaceRoutes = require("./ml-marketplace");

app.use("/handheld", handheldRoutes);
app.use("/outbound-transfers", outboundRoutes);
app.use("/inbound-approvals", inboundRoutes);
app.use("/driver-assignments", driverAssignmentsRoutes);
app.use("/marketplace", mlMarketplaceRoutes);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(
    `🚀 SKF Marketplace API Server running on http://localhost:${PORT}`,
  );
});
