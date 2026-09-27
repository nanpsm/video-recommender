"""Simulate a stream of user rating events and publish them to Kafka.

In a real system this would be your web/app server sending events whenever
a user rates a movie. Here we generate random (user, movie, rating) triples
from the MovieLens dataset so the IDs are realistic.

Run from the project root:  uv run python -m video_recommender.producer

Keep this running in one terminal while streaming.py runs in another.
Press Ctrl+C to stop.
"""
import json
import random
import time

from kafka import KafkaProducer

# The Kafka topic is like a named channel. The producer writes here;
# the Spark consumer reads from the same topic name.
TOPIC = "rating-events"
KAFKA_BROKER = "localhost:9092"  # matches the port we exposed in docker-compose.yml

# Path to the ratings file — we read it once to get valid user/movie IDs
RATINGS_FILE = "data/ml-latest-small/ratings.csv"

# How long to wait between sending events (seconds)
DELAY_SECONDS = 2


def load_ids(path: str) -> tuple[list[int], list[int]]:
    """Read unique user IDs and movie IDs from the CSV (no Spark needed here —
    it's a small file and we just need the ID lists)."""
    user_ids, movie_ids = set(), set()
    with open(path) as f:
        next(f)  # skip header
        for line in f:
            uid, mid, *_ = line.strip().split(",")
            user_ids.add(int(uid))
            movie_ids.add(int(mid))
    return sorted(user_ids), sorted(movie_ids)


def main():
    print(f"Connecting to Kafka at {KAFKA_BROKER}...")

    # KafkaProducer is the client that sends messages to Kafka.
    # value_serializer converts our Python dict → JSON bytes before sending.
    # Kafka only understands bytes — not Python objects.
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BROKER,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )
    print(f"Connected. Sending events to topic '{TOPIC}' every {DELAY_SECONDS}s...")
    print("Press Ctrl+C to stop.\n")

    user_ids, movie_ids = load_ids(RATINGS_FILE)

    # Ratings in MovieLens are 0.5–5.0 in 0.5 steps
    possible_ratings = [r / 2 for r in range(1, 11)]

    sent = 0
    try:
        while True:
            event = {
                "userId": random.choice(user_ids),
                "movieId": random.choice(movie_ids),
                "rating": random.choice(possible_ratings),
                "timestamp": int(time.time()),
            }

            # send() is asynchronous — it queues the message.
            # flush() waits until Kafka confirms it was received.
            producer.send(TOPIC, value=event)
            producer.flush()

            sent += 1
            print(f"[{sent:>4}] user={event['userId']:<4} "
                  f"movie={event['movieId']:<6} "
                  f"rating={event['rating']} "
                  f"ts={event['timestamp']}")

            time.sleep(DELAY_SECONDS)

    except KeyboardInterrupt:
        print(f"\nStopped after {sent} events.")
    finally:
        producer.close()


if __name__ == "__main__":
    main()
