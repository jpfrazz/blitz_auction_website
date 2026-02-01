#! /usr/bin/env bash
docker compose -f docker-compose-local.yml --env-file=.env.dev up --build
