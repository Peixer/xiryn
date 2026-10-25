# syntax=docker/dockerfile:1

# The machine every Xiryn agent works on: a Linux desktop with a real browser,
# streamed over noVNC, plus the everyday developer tools. Xiryn builds it once
# on your computer (`npm run setup`, or on first use) and runs one container
# per agent from it.

FROM debian:trixie-slim

ARG NODE_VERSION=24.20.0
ARG CLOUDFLARED_VERSION=2026.9.1

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    DISPLAY=:1 \
    XIRYN_SCREEN=1280x800 \
    PIP_BREAK_SYSTEM_PACKAGES=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb x11vnc novnc websockify xdotool scrot x11-utils x11-xserver-utils dbus-x11 \
      xfwm4 xfce4-panel xfce4-settings xfconf xfce4-terminal thunar \
      adwaita-icon-theme gnome-themes-extra feh \
      chromium fonts-noto-core fonts-noto-color-emoji fonts-liberation fonts-dejavu-core \
      bash-completion ca-certificates curl wget git jq less nano procps iproute2 \
      sudo tini tzdata unzip zip xz-utils openssh-client \
      python3 python3-pip python3-venv python-is-python3 \
      # Screen recording — lets agents record demos and capture video evidence
      ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Node.js from the official build (Debian's is older and pulls in hundreds of
# packages), and cloudflared for temporary take-over links
RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unsupported: $arch" >&2; exit 1 ;; esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --no-same-owner \
      --exclude='*/README.md' --exclude='*/CHANGELOG.md' --exclude='*/LICENSE' \
 && curl -fsSL -o /usr/local/bin/cloudflared \
    "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${arch}" \
 && chmod +x /usr/local/bin/cloudflared \
 && node --version && cloudflared --version

# The agent works as an ordinary user. This image still has a sudoers file,
# but new containers drop every capability, so sudo does not work.
# None of the agent's files touch your computer.
RUN useradd --create-home --uid 1000 --shell /bin/bash xiryn \
 && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
 && echo 'xiryn ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/xiryn \
 && chmod 0440 /etc/sudoers.d/xiryn

COPY rootfs/ /

# Scripts must stay runnable even if a checkout converted line endings.
# Only Xiryn's own: node and cloudflared live in the same folder.
RUN sed -i 's/\r$//' /usr/local/bin/xiryn-* /usr/local/bin/browser /etc/chromium.d/xiryn \
 && chmod +x /usr/local/bin/xiryn-* /usr/local/bin/browser \
 && mkdir -p /home/xiryn/.coding-creds /home/xiryn/.local/bin \
 && chown -R xiryn:xiryn /home/xiryn

USER xiryn
WORKDIR /home/xiryn
EXPOSE 6080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["xiryn-desktop"]
