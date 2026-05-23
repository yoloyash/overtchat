import { auth } from "../lib/auth/server";
import { db } from "../lib/db/client";
import { modelConfigs } from "../lib/db/schema";

async function seed() {
  console.log("🌱 Starting database seed...");

  // --- 1. USER SEEDING ---
  console.log("\n--- Seeding Users ---");

  // Override the database hook in memory so the script can bypass the "Signup is closed" rule
  if (auth.options.databaseHooks?.user?.create?.before) {
    auth.options.databaseHooks.user.create.before = async (data) => {
       return { data }; 
    };
  }

  const usersToCreate = [
    {
      email: "yash@boomer-hub.uk",
      password: "coiled-grandpa",
      name: "Yash Khurana",
      role: "admin",
    },
    {
      email: "swamita@boomer-hub.uk",
      password: "coiled-grandpa",
      name: "Swamita",
      role: "user",
    }
  ];

  for (const u of usersToCreate) {
    console.log(`👤 Creating user: ${u.email} (${u.role})...`);
    try {
      const res = await auth.api.signUpEmail({
        body: {
          email: u.email,
          password: u.password,
          name: u.name,
        },
      });

      // `auth.api.updateUser` can't touch role — that's gated by the admin
      // plugin. Stamp it directly on the user row.
      if (u.role === "admin" && res?.user?.id) {
        const { user } = await import("../lib/db/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(user).set({ role: "admin" }).where(eq(user.id, res.user.id));
      }

      console.log(`✅ User ${u.email} created successfully!`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        console.log(`⚠️ User ${u.email} already exists. Skipping creation.`);
      } else {
        console.error(`❌ Failed to create user ${u.email}:`, message);
      }
    }
  }

  // --- 2. MODEL CONFIG SEEDING ---
  console.log("\n--- Seeding Model Configs ---");

  const modelsToCreate = [
    {
      label: "Qwen 3.6",
      baseUrl: "http://10.0.0.200:8000/v1",
      model: "qwen36",
      systemPrompt: "Keep responses short to medium length.",
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false
        }
      },
      sortOrder: 1
    },
    {
      label: "Qwen 3.6 Thinking",
      baseUrl: "http://10.0.0.200:8000/v1",
      model: "qwen36",
      systemPrompt: "Keep responses short to medium length.",
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: true
        }
      },
      sortOrder: 2
    }
  ];

  for (const modelData of modelsToCreate) {
    console.log(`🛠️ Creating model config: ${modelData.label}...`);
    try {
      await db.insert(modelConfigs).values({
        id: crypto.randomUUID(),
        label: modelData.label,
        baseUrl: modelData.baseUrl.replace(/\/$/, ""),
        model: modelData.model,
        systemPrompt: modelData.systemPrompt,
        extraBody: modelData.extraBody,
        sortOrder: modelData.sortOrder
      });
      console.log(`✅ Model ${modelData.label} created successfully!`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to create model config ${modelData.label}:`, message);
    }
  }

  console.log("\n🎉 Seeding complete.");
  process.exit(0);
}

seed();