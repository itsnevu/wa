FROM postgres:16
RUN apt-get update && apt-get install -y --no-install-recommends pgbouncer && rm -rf /var/lib/apt/lists/*
COPY pgbouncer.ini users.txt /fixture/
USER postgres
ENTRYPOINT ["pgbouncer", "/fixture/pgbouncer.ini"]
