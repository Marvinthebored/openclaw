// Standalone diagnostic reduction of the SIGPROF/rwlock combination in V8 11399.
// Not a reproduction of Node MessagePort internals or proof of the Gateway cause.
#include <pthread.h>
#include <signal.h>
#include <unistd.h>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>

constexpr size_t kThreads = 4;
constexpr size_t kLocks = 1024;
struct Lock { pthread_rwlock_t rw; pthread_mutex_t mutex; };
std::array<Lock, kLocks> locks;
struct Stats { std::atomic<unsigned long long> operations{0}; };
std::array<Stats, kThreads> stats;
std::atomic<bool> start{false}, stop{false};
static_assert(std::atomic<unsigned long long>::is_always_lock_free, "Signal counter must be lock-free");
std::atomic<unsigned long long> received{0};
void on_signal(int) { received.fetch_add(1, std::memory_order_relaxed); }
void check(int code) { if (code) { std::fprintf(stderr, "pthread error: %s\n", std::strerror(code)); std::abort(); } }

int main(int argc, char** argv) {
  if (argc != 4 || (std::strcmp(argv[1], "rwlock") && std::strcmp(argv[1], "mutex"))) return 2;
  const bool use_rw = std::strcmp(argv[1], "rwlock") == 0;
  const int seconds = std::atoi(argv[2]), interval_us = std::atoi(argv[3]);
  if (seconds < 1 || seconds > 3600 || interval_us < 0 || interval_us > 1000000) return 2;
  for (auto& lock : locks) {
    check(pthread_rwlock_init(&lock.rw, nullptr));
    check(pthread_mutex_init(&lock.mutex, nullptr));
  }
  struct sigaction action{};
  action.sa_handler = on_signal;
  sigemptyset(&action.sa_mask);
  action.sa_flags = SA_RESTART;
  if (sigaction(SIGPROF, &action, nullptr)) return 3;
  std::array<std::thread, kThreads> workers;
  for (size_t index = 0; index < kThreads; ++index) {
    workers[index] = std::thread([index, use_rw] {
      unsigned long long random = 0x9e3779b97f4a7c15ULL + index;
      while (!start.load(std::memory_order_acquire)) std::this_thread::yield();
      while (!stop.load(std::memory_order_relaxed)) {
        random ^= random << 13; random ^= random >> 7; random ^= random << 17;
        auto& lock = locks[random % kLocks];
        if (use_rw) {
          check((random >> 20) & 1 ? pthread_rwlock_wrlock(&lock.rw) : pthread_rwlock_rdlock(&lock.rw));
          check(pthread_rwlock_unlock(&lock.rw));
        } else {
          check(pthread_mutex_lock(&lock.mutex)); check(pthread_mutex_unlock(&lock.mutex));
        }
        stats[index].operations.fetch_add(1, std::memory_order_relaxed);
      }
    });
  }
  // Workers remain alive until this sender stops: no pthread_kill against joined IDs.
  std::atomic<bool> sender_stop{false};
  std::thread sender([&] {
    if (!interval_us) return;
    while (!sender_stop.load(std::memory_order_relaxed)) {
      for (auto& worker : workers) check(pthread_kill(worker.native_handle(), SIGPROF));
      std::this_thread::sleep_for(std::chrono::microseconds(interval_us));
    }
  });
  start.store(true, std::memory_order_release);
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
  while (std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
    std::printf(R"({"event":"progress","perThread":[)");
    for (size_t i = 0; i < kThreads; ++i) std::printf("%s%llu", i ? "," : "", stats[i].operations.load());
    std::puts("]}"); std::fflush(stdout);
  }
  sender_stop.store(true); sender.join();
  stop.store(true);
  for (auto& worker : workers) worker.join();
  unsigned long long operations = 0;
  const auto signals = received.load(std::memory_order_relaxed);
  for (auto& result : stats) operations += result.operations.load();
  std::printf(R"({"event":"complete","lock":"%s","intervalUs":%d,"operations":%llu,"signalsDelivered":%llu})", argv[1], interval_us, operations, signals); std::putchar(10);
  for (auto& lock : locks) { check(pthread_rwlock_destroy(&lock.rw)); check(pthread_mutex_destroy(&lock.mutex)); }
  return operations == 0 || (interval_us && !signals) ? 4 : 0;
}
