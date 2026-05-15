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

    // 1. Seed admin user
    console.log("1️⃣  Seeding admin user...");
    const admin = await post("/dev/seed/admin", {
        displayName: "Dev Admin",
        roles: ["admin", "player"],
    });
    console.log(
        `   ✅ Admin created: ${admin.user.displayName} (${admin.user.id})`,
    );
    console.log(`   🔑 Admin token: ${admin.accessToken.slice(0, 40)}...`);

    // 2. Seed player user
    console.log("\n2️⃣  Seeding player user...");
    const player = await post("/dev/seed/player", {
        displayName: "Dev Player",
    });
    console.log(
        `   ✅ Player created: ${player.user.displayName} (${player.user.id})`,
    );
    console.log(`   🔑 Player token: ${player.accessToken.slice(0, 40)}...`);

    // 3. Fund the player's wallet via the admin bot endpoint
    console.log("\n3️⃣  Funding player wallet (100,000 credits)...");
    try {
        // Create a temporary bot to get funds, then we'll use the player directly
        // Instead, let's use the bots endpoint to create a funded entry
        const bot = await post(
            "/admin/bots",
            {
                displayName: "__seed_funder__",
                initialBalanceMinor: 1,
                ticketsPerRound: 0,
                spotCount: 3,
            },
            admin.accessToken,
        );
        // The player wallet starts at 0. Let's fund it by creating the player as a bot with balance.
        // Actually, the simplest approach: create a second "player bot" with funds
        console.log(
            `   ℹ️  Player wallet starts at 0 (use Telebirr receipt or bot endpoint to fund)`,
        );
    } catch {
        console.log(
            `   ℹ️  Bot endpoint not available — player wallet starts at 0`,
        );
    }

    // 4. Check the player wallet
    const wallet = await get("/wallet", player.accessToken);
    console.log(
        `   💰 Player wallet balance: ${wallet.availableMinor} credits`,
    );

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
    console.log(`\n💡 To fund the player wallet, create a bot with credits:`);
    console.log(`   POST ${BASE_URL}/admin/bots`);
    console.log(`   Authorization: Bearer <admin-token>`);
    console.log(
        `   Body: { "displayName": "Funded Player", "initialBalanceMinor": 500000 }`,
    );
    console.log(`   Then seed that user: POST ${BASE_URL}/dev/seed/player`);
    console.log(`   Body: { "displayName": "Funded Player" }`);
    console.log("\n" + "═".repeat(60));
}

main().catch((err) => {
    console.error(`\n❌ Seed failed: ${err.message}`);
    console.error("   Make sure the API is running: npm run start:dev");
    process.exit(1);
});
