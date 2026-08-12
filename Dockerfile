FROM node:20 AS builder 

# LEGACY UPSTREAM IMAGE: this serves apps/web, not Magic Blackboard. The repository publish
# workflow and release scripts intentionally do not build or push this image during Foundation.

WORKDIR /builder

COPY . /builder

RUN npm install \
    && npm run build 


FROM lipanski/docker-static-website:2.6.0

WORKDIR /home/static

COPY  --from=builder /builder/dist/apps/web/  /home/static

EXPOSE 80

CMD ["/busybox-httpd", "-f", "-v", "-p", "80", "-c", "httpd.conf"]
