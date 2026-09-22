// Initialize the application when the window loads.
window.onload = async function() {
    try {
        const resultElement = document.getElementById('result');
        resultElement.textContent = "Loading movie data...";
        resultElement.className = "loading";

        await loadData();

        populateMoviesDropdown();
        populateProfileDropdowns();

        resultElement.textContent = "Data loaded. Please select a movie.";
        resultElement.className = "success";
    } catch (error) {
        console.error("Initialization error:", error);
    }
};


// Populate the movies dropdown with titles in alphabetical order.
function populateMoviesDropdown() {
    const selectElement = document.getElementById("movie-select");

    while (selectElement.options.length > 1) {
        selectElement.remove(1);
    }

    const sortedMovies = [...movies].sort((a, b) =>
        a.title.localeCompare(b.title)
    );

    sortedMovies.forEach(movie => {
        const option = document.createElement("option");
        option.value = movie.id;
        option.textContent = movie.title;
        selectElement.appendChild(option);
    });
}
// Populate the three dropdowns used for profile-based recommendations.
function populateProfileDropdowns() {
    const profileSelectIds = [
        "profile-select-1",
        "profile-select-2",
        "profile-select-3"
    ];

    const sortedMovies = [...movies].sort((a, b) =>
        a.title.localeCompare(b.title)
    );

    profileSelectIds.forEach(id => {
        const selectElement = document.getElementById(id);

        sortedMovies.forEach(movie => {
            const option = document.createElement("option");
            option.value = movie.id;
            option.textContent = movie.title;
            selectElement.appendChild(option);
        });
    });
}

// Convert a movie's genres into a binary vector using the fixed order
// of genreNames defined in data.js.
function movieToVector(movie) {
    return genreNames.map(genre => movie.genres.includes(genre) ? 1 : 0);
}


// Calculate cosine similarity between two numeric vectors.
function cosineSimilarity(vectorA, vectorB) {
    const dotProduct = vectorA.reduce(
        (sum, value, index) => sum + value * vectorB[index],
        0
    );

    const normA = Math.sqrt(
        vectorA.reduce((sum, value) => sum + value * value, 0)
    );

    const normB = Math.sqrt(
        vectorB.reduce((sum, value) => sum + value * value, 0)
    );

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (normA * normB);
}


// Main item-to-item recommendation function.
function getRecommendations() {
    const resultElement = document.getElementById("result");

    try {
        const selectElement = document.getElementById("movie-select");
        const selectedMovieId = parseInt(selectElement.value);

        if (isNaN(selectedMovieId)) {
            resultElement.textContent = "Please select a movie first.";
            resultElement.className = "error";
            return;
        }

        const likedMovie = movies.find(movie => movie.id === selectedMovieId);

        if (!likedMovie) {
            resultElement.textContent =
                "Error: Selected movie not found in database.";
            resultElement.className = "error";
            return;
        }

        resultElement.textContent = "Calculating cosine-similarity recommendations...";
        resultElement.className = "loading";

        setTimeout(() => {
            try {
                const likedVector = movieToVector(likedMovie);

                const scoredMovies = movies
                    .filter(movie => movie.id !== likedMovie.id)
                    .map(movie => ({
                        ...movie,
                        score: cosineSimilarity(
                            likedVector,
                            movieToVector(movie)
                        )
                    }))
                    .sort((a, b) => {
                        if (b.score !== a.score) {
                            return b.score - a.score;
                        }

                        return a.title.localeCompare(b.title);
                    });

                const seenTitles = new Set();

const uniqueScoredMovies = scoredMovies.filter(movie => {
    if (seenTitles.has(movie.title)) {
        return false;
    }

    seenTitles.add(movie.title);
    return true;
});

const topRecommendations = uniqueScoredMovies.slice(0, 5);

                if (topRecommendations.length > 0) {
                    const recommendationText = topRecommendations
                        .map((movie, index) =>
                            `${index + 1}. ${movie.title} ` +
                            `(cosine: ${movie.score.toFixed(3)}; ` +
                            `genres: ${movie.genres.join(", ")})`
                        )
                        .join("\n");

                    resultElement.textContent =
                        `Because you liked "${likedMovie.title}", ` +
                        `we recommend:\n${recommendationText}`;

                    resultElement.className = "success";
                } else {
                    resultElement.textContent =
                        `No recommendations found for "${likedMovie.title}".`;
                    resultElement.className = "error";
                }
            } catch (error) {
                console.error("Error in recommendation calculation:", error);
                resultElement.textContent =
                    "An error occurred while calculating recommendations.";
                resultElement.className = "error";
            }
        }, 100);
    } catch (error) {
        console.error("Error in getRecommendations:", error);
        resultElement.textContent = "An unexpected error occurred.";
        resultElement.className = "error";
    }
}
// Read and validate the three movies selected for the profile.
function getProfileMovies() {
    const profileSelectIds = [
        "profile-select-1",
        "profile-select-2",
        "profile-select-3"
    ];

    const selectedIds = profileSelectIds.map(id =>
        parseInt(document.getElementById(id).value)
    );

    // All three dropdowns must have a selected movie.
    if (selectedIds.some(id => isNaN(id))) {
        return null;
    }

    // The profile must contain three different movies.
    if (new Set(selectedIds).size !== 3) {
        return null;
    }

    const selectedMovies = selectedIds.map(id =>
        movies.find(movie => movie.id === id)
    );

    // This protects against an invalid id or a missing catalog item.
    if (selectedMovies.some(movie => !movie)) {
        return null;
    }

    return selectedMovies;
}


// Average the three fixed-order binary genre vectors element by element.
function averageMovieVectors(selectedMovies) {
    const vectors = selectedMovies.map(movieToVector);

    return genreNames.map((_, index) => {
        const total = vectors.reduce(
            (sum, vector) => sum + vector[index],
            0
        );

        return total / vectors.length;
    });
}


// Create Top-5 recommendations using cosine similarity to the profile vector.
function recommendByProfile() {
    const resultElement = document.getElementById("profile-result");
    const selectedMovies = getProfileMovies();

    if (!selectedMovies) {
        resultElement.textContent =
            "Please select three different movies for the profile.";
        resultElement.className = "error";
        return;
    }

    try {
        const profileVector = averageMovieVectors(selectedMovies);
        const selectedIds = new Set(selectedMovies.map(movie => movie.id));

        const scoredMovies = movies
    .filter(movie => !selectedIds.has(movie.id))
    .map(movie => ({
        ...movie,
        score: cosineSimilarity(
            profileVector,
            movieToVector(movie)
        )
    }))
    .sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }

        return a.title.localeCompare(b.title);
    });

const seenTitles = new Set();

const uniqueScoredMovies = scoredMovies.filter(movie => {
    if (seenTitles.has(movie.title)) {
        return false;
    }

    seenTitles.add(movie.title);
    return true;
});

const topRecommendations = uniqueScoredMovies.slice(0, 5);

        const selectedTitles = selectedMovies
            .map(movie => movie.title)
            .join(", ");

        const recommendationText = topRecommendations
            .map((movie, index) =>
                `${index + 1}. ${movie.title} ` +
                `(cosine: ${movie.score.toFixed(3)}; ` +
                `genres: ${movie.genres.join(", ")})`
            )
            .join("\n");

        resultElement.textContent =
            `Profile built from: ${selectedTitles}\n` +
            `Top-5 profile recommendations:\n${recommendationText}`;

        resultElement.className = "success";
    } catch (error) {
        console.error("Error in profile recommendation calculation:", error);
        resultElement.textContent =
            "An error occurred while calculating profile recommendations.";
        resultElement.className = "error";
    }
}