import os
import discord
import psycopg
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_ROLE_SYNC_TOKEN")

conn = psycopg.connect(
    host=os.getenv("POSTGRES_HOST"),
    port=os.getenv("POSTGRES_PORT"),
    dbname=os.getenv("POSTGRES_DB"),
    user=os.getenv("POSTGRES_USER"),
    password=os.getenv("POSTGRES_PASSWORD")
)

intents = discord.Intents.default()
intents.members = True

client = discord.Client(intents=intents)

def sync_roles(user_id, after_roles, before_roles):


    add_roles = after_roles.difference(before_roles)
    remove_roles = before_roles.difference(after_roles)

    with conn.cursor() as cur:
        for role in remove_roles:

            cur.execute(
            "DELETE FROM user_roles WHERE user_id = %s and role = %s",
            (str(user_id), str(role))
            )

        for role in add_roles:
            cur.execute(
                """
                INSERT INTO user_roles (user_id, role)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                (str(user_id), str(role))
            )

    conn.commit()

@client.event
async def on_member_update(before, after):

    before_roles = set(before.roles)
    after_roles = set(after.roles)

    if before_roles != after_roles:
        print(f"Role update detected for {after.id}")
        sync_roles(after.id, after_roles, before_roles)

client.run(TOKEN)
