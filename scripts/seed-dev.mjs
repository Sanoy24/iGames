/* eslint-disable no-undef */
/**
 * Dev seed script — creates test users with funded wallets.
 *
 * Prerequisites:
 *   1. MongoDB running (docker compose up -d)
 *   2. API running (npm run start:dev)
 *
 * Usage:
 *   node scripts/seed-dev.mjs
 *   node scripts/seed-dev.mjs http://localhost:3000   (custom base URL)
 */

const BASE_URL = process.argv[2] || "http://localhost:3000";

async function post(path, body, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${path}: ${text}`);
    }
    return res.json();
}

async function get(path, token) {
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, { headers });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${path}: ${text}`);
    }
    return res.json();
}

async function main() {
    console.log(`\n🎮 iGames Dev Seed`);
    console.log(`   Base URL: ${BASE_URL}\n`);

    // 1. Seed admin user with some initial funds
    console.log("1️⃣  Seeding admin user...");
    const admin = await post("/dev/seed/admin", {
        displayName: "Dev Admin",
        roles: ["admin", "player"],
        initialBalanceMinor: 500000, // 5,000 credits
    });
    console.log(
        `   ✅ Admin created: ${admin.user.displayName} (${admin.user.id})`,
    );
    console.log(`   🔑 Admin token: ${admin.accessToken.slice(0, 40)}...`);

    // 2. Seed player user with some initial funds
    console.log("\n2️⃣  Seeding player user...");
    const player = await post("/dev/seed/player", {
        displayName: "Dev Player",
        initialBalanceMinor: 100000, // 1,000 credits
    });
    console.log(
        `   ✅ Player created: ${player.user.displayName} (${player.user.id})`,
    );
    console.log(`   🔑 Player token: ${player.accessToken.slice(0, 40)}...`);

    // 3. Verify wallets
    console.log("\n3️⃣  Verifying wallet balances...");
    const adminWallet = await get("/wallet", admin.accessToken);
    const playerWallet = await get("/wallet", player.accessToken);

    console.log(`   💰 Admin balance: ${adminWallet.availableMinor} credits`);
    console.log(`   💰 Player balance: ${playerWallet.availableMinor} credits`);

    // 5. Print summary
    console.log("\n" + "═".repeat(60));
    console.log("📋 POSTMAN SETUP — Copy these values:");
    console.log("═".repeat(60));
    console.log(
        `\n🔐 Admin Token (use for admin/* endpoints):\n${admin.accessToken}\n`,
    );
    console.log(
        `🎮 Player Token (use for keno/bingo/wallet endpoints):\n${player.accessToken}\n`,
    );
    console.log(`👤 Admin User ID:  ${admin.user.id}`);
    console.log(`👤 Player User ID: ${player.user.id}`);
    console.log(`\n💡 To create more funded users, use the seed endpoint:`);
    console.log(`   POST ${BASE_URL}/dev/seed/player`);
    console.log(
        `   Body: { "displayName": "New User", "initialBalanceMinor": 500000 }`,
    );
    console.log("\n" + "═".repeat(60));
}

main().catch((err) => {
    console.error(`\n❌ Seed failed: ${err.message}`);
    console.error("   Make sure the API is running: npm run start:dev");
    process.exit(1);
});
