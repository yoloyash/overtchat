// Starts one sandboxed program as an unprivileged, single-use user.
//
//   runner <uid> <cpu-seconds> <memory-bytes> <max-processes>
//          <max-file-bytes> <program> [args...]
//
// The server runs as root inside the container only so it can switch users.
// This launcher applies resource limits while still privileged, drops every
// group and the root identity, forbids regaining privileges, and installs a
// seccomp filter before replacing itself with the program. The filter allows
// ordinary computation and local files but denies network sockets, new
// namespaces, tracing and kernel administration.

#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <sched.h>
#include <seccomp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static void fail(const char *message) {
  perror(message);
  _exit(125);
}

static unsigned long long number(const char *value, const char *name) {
  char *end = NULL;
  errno = 0;
  unsigned long long parsed = strtoull(value, &end, 10);
  if (errno || !end || *end || parsed == 0) {
    fprintf(stderr, "runner: invalid %s\n", name);
    _exit(125);
  }
  return parsed;
}

static void limit(int resource, rlim_t value, const char *name) {
  struct rlimit bound = {value, value};
  if (setrlimit(resource, &bound) != 0) fail(name);
}

static void deny(scmp_filter_ctx filter, int syscall, int error) {
  // Syscalls the build's headers know but this architecture lacks resolve to
  // a negative number; there is nothing to deny for those.
  if (syscall < 0) return;
  if (seccomp_rule_add(filter, SCMP_ACT_ERRNO(error), syscall, 0) != 0) {
    fail("seccomp_rule_add");
  }
}

static void install_filter(void) {
  scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ALLOW);
  if (!filter) fail("seccomp_init");

  // Local sockets (for example multiprocessing) remain; every other address
  // family, including IP and netlink, is refused.
  if (seccomp_rule_add(filter, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socket), 1,
                       SCMP_A0(SCMP_CMP_NE, AF_UNIX)) != 0 ||
      seccomp_rule_add(filter, SCMP_ACT_ERRNO(EACCES), SCMP_SYS(socketpair), 1,
                       SCMP_A0(SCMP_CMP_NE, AF_UNIX)) != 0) {
    fail("seccomp socket rule");
  }

  // New namespaces would undo the isolation. clone3 passes its flags in
  // memory the filter cannot read, so callers fall back to clone.
  const unsigned long namespaces[] = {
      CLONE_NEWNS,  CLONE_NEWUSER, CLONE_NEWPID,    CLONE_NEWNET,
      CLONE_NEWIPC, CLONE_NEWUTS,  CLONE_NEWCGROUP,
  };
  for (size_t i = 0; i < sizeof(namespaces) / sizeof(namespaces[0]); i++) {
    if (seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(clone), 1,
                         SCMP_A0(SCMP_CMP_MASKED_EQ, namespaces[i],
                                 namespaces[i])) != 0) {
      fail("seccomp clone rule");
    }
  }
  deny(filter, SCMP_SYS(clone3), ENOSYS);

  const int denied[] = {
      SCMP_SYS(ptrace),          SCMP_SYS(process_vm_readv),
      SCMP_SYS(process_vm_writev), SCMP_SYS(unshare),
      SCMP_SYS(setns),           SCMP_SYS(mount),
      SCMP_SYS(umount2),         SCMP_SYS(pivot_root),
      SCMP_SYS(chroot),          SCMP_SYS(open_by_handle_at),
      SCMP_SYS(name_to_handle_at), SCMP_SYS(bpf),
      SCMP_SYS(perf_event_open), SCMP_SYS(userfaultfd),
      SCMP_SYS(keyctl),          SCMP_SYS(add_key),
      SCMP_SYS(request_key),     SCMP_SYS(io_uring_setup),
      SCMP_SYS(io_uring_enter),  SCMP_SYS(io_uring_register),
      SCMP_SYS(kexec_load),      SCMP_SYS(kexec_file_load),
      SCMP_SYS(init_module),     SCMP_SYS(finit_module),
      SCMP_SYS(delete_module),   SCMP_SYS(acct),
      SCMP_SYS(swapon),          SCMP_SYS(swapoff),
      SCMP_SYS(reboot),          SCMP_SYS(syslog),
      SCMP_SYS(quotactl),        SCMP_SYS(settimeofday),
      SCMP_SYS(clock_settime),   SCMP_SYS(adjtimex),
      SCMP_SYS(clock_adjtime),   SCMP_SYS(vhangup),
      SCMP_SYS(fanotify_init),
  };
  for (size_t i = 0; i < sizeof(denied) / sizeof(denied[0]); i++) {
    deny(filter, denied[i], EPERM);
  }

  if (seccomp_load(filter) != 0) fail("seccomp_load");
  seccomp_release(filter);
}

int main(int argc, char **argv) {
  if (argc < 7) {
    fprintf(stderr,
            "usage: runner <uid> <cpu-seconds> <memory-bytes> <max-processes> "
            "<max-file-bytes> <program> [args...]\n");
    return 125;
  }
  uid_t uid = (uid_t)number(argv[1], "uid");
  if (uid < 1000) {
    fprintf(stderr, "runner: refusing a system uid\n");
    return 125;
  }

  limit(RLIMIT_CPU, number(argv[2], "cpu seconds"), "RLIMIT_CPU");
  limit(RLIMIT_AS, number(argv[3], "memory bytes"), "RLIMIT_AS");
  // Process limits count per user; each run has its own user.
  limit(RLIMIT_NPROC, number(argv[4], "max processes"), "RLIMIT_NPROC");
  limit(RLIMIT_FSIZE, number(argv[5], "max file bytes"), "RLIMIT_FSIZE");
  limit(RLIMIT_NOFILE, 512, "RLIMIT_NOFILE");
  limit(RLIMIT_CORE, 0, "RLIMIT_CORE");

  if (setgroups(0, NULL) != 0) fail("setgroups");
  if (setgid((gid_t)uid) != 0) fail("setgid");
  if (setuid(uid) != 0) fail("setuid");
  if (setuid(0) == 0) {
    fprintf(stderr, "runner: privileges were not dropped\n");
    return 125;
  }
  umask(077);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("no_new_privs");
  install_filter();

  execv(argv[6], &argv[6]);
  fail("execv");
  return 125;
}
