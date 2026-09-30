// Global variables
let model;
let isTraining = false;

// Initialize application when window loads
window.onload = async function() {
    try {
        // Update status
        updateStatus('Loading MovieLens data...');
        
        // Load data first
        await loadData();
        
        // Build the CF lookup tables as soon as the ratings exist. This is
        // synchronous and needs no model, no CDN and no network, so both CF
        // methods are usable the moment this returns.
        initCollaborativeFiltering(ratings);
        
        // Populate dropdowns
        populateUserDropdown();
        populateMovieDropdown();
        
        // Enable Predict. Nothing is trained on load any more, so this is the
        // only gate there is.
        document.getElementById('predict-btn').disabled = false;
        
        updateStatus(`Ready: ${ratings.length.toLocaleString()} observed ratings indexed `
            + `across ${numUsers} users and ${numMovies} movies. `
            + `Pick a user and a movie, then Predict Rating.`);
        
    } catch (error) {
        console.error('Initialization error:', error);
        updateStatus('Error initializing application: ' + error.message, true);
    }
};

function populateUserDropdown() {
    const userSelect = document.getElementById('user-select');
    userSelect.innerHTML = '';
    
    // Add users (assuming user IDs are sequential from 1 to numUsers)
    for (let i = 1; i <= numUsers; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `User ${i}`;
        userSelect.appendChild(option);
    }
}

function populateMovieDropdown() {
    const movieSelect = document.getElementById('movie-select');
    movieSelect.innerHTML = '';
    
    // Add movies
    movies.forEach(movie => {
        const option = document.createElement('option');
        option.value = movie.id;
        option.textContent = movie.year ? `${movie.title} (${movie.year})` : movie.title;
        movieSelect.appendChild(option);
    });
}

// ---------------------------------------------------------------------
// The Matrix Factorization baseline below is retained from the starter
// code but is intentionally not used by this page: window.onload no longer
// calls trainModel(), no control dispatches to predictRating(), and there
// is no MF option in the UI. It also needs TensorFlow.js, which this page
// no longer loads. Kept intact for reference, dead as shipped.
// ---------------------------------------------------------------------

function createModel(numUsers, numMovies, latentDim = 10) {
    // User input
    const userInput = tf.input({shape: [1], name: 'userInput'});
    
    // Movie input  
    const movieInput = tf.input({shape: [1], name: 'movieInput'});
    
    // User embedding
    const userEmbedding = tf.layers.embedding({
        inputDim: numUsers + 1,
        outputDim: latentDim,
        name: 'userEmbedding'
    }).apply(userInput);
    
    // Movie embedding
    const movieEmbedding = tf.layers.embedding({
        inputDim: numMovies + 1,
        outputDim: latentDim, 
        name: 'movieEmbedding'
    }).apply(movieInput);
    
    // Reshape embeddings to flatten them
    const userVector = tf.layers.flatten().apply(userEmbedding);
    const movieVector = tf.layers.flatten().apply(movieEmbedding);
    
    // Dot product of user and movie vectors
    const dotProduct = tf.layers.dot({axes: 1}).apply([userVector, movieVector]);
    
    // Reshape to get a single output value
    const prediction = tf.layers.reshape({targetShape: [1]}).apply(dotProduct);
    
    // Create model
    const model = tf.model({
        inputs: [userInput, movieInput],
        outputs: prediction
    });
    
    return model;
}

async function trainModel() {
    try {
        isTraining = true;
        // The Predict button stays enabled during training: the two CF
        // methods do not need this model. predictRating() refuses on its
        // own if the TF.js baseline is selected before training finishes.
        
        // Create model
        model = createModel(numUsers, numMovies, 10);
        
        // Compile model
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError'
        });
        
        // Prepare training data
        const userIds = ratings.map(r => r.userId);
        const movieIds = ratings.map(r => r.movieId);
        const ratingValues = ratings.map(r => r.rating);
        
        const userTensor = tf.tensor2d(userIds, [userIds.length, 1]);
        const movieTensor = tf.tensor2d(movieIds, [movieIds.length, 1]);
        const ratingTensor = tf.tensor2d(ratingValues, [ratingValues.length, 1]);
        
        // Train model
        updateStatus('Training model... (This may take a moment)');
        
        await model.fit([userTensor, movieTensor], ratingTensor, {
            epochs: 10,
            batchSize: 64,
            validationSplit: 0.1,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    updateStatus(`Training epoch ${epoch + 1}/10 - loss: ${logs.loss.toFixed(4)}`);
                }
            }
        });
        
        // Clean up tensors
        tf.dispose([userTensor, movieTensor, ratingTensor]);
        
        // Update UI
        updateStatus('Model training completed successfully!');
        document.getElementById('predict-btn').disabled = false;
        isTraining = false;
        
    } catch (error) {
        console.error('Training error:', error);
        updateStatus('Error training model: ' + error.message, true);
        isTraining = false;
    }
}
// One click, both methods, same user and same movie. There is no method
// selector on this page, so nothing here branches on a chosen technique.
function onPredictClicked() {
    const userId = parseInt(document.getElementById('user-select').value, 10);
    const movieId = parseInt(document.getElementById('movie-select').value, 10);

    if (!userId || !movieId) {
        renderPanel('user-panel', 'User-Based CF', { notice: 'Please select both a user and a movie.' });
        renderPanel('item-panel', 'Item-Based CF', { notice: 'Please select both a user and a movie.' });
        return;
    }

    const userRatings = ratingsByUser(userId);
    const alreadyRated = userRatings ? userRatings.get(movieId) : undefined;
    const title = movieLabel(movieId);

    // An observed rating is not a prediction. Presenting a computed number for
    // a pair we already know would misrepresent the method's accuracy, so both
    // panels report the observed value instead of estimating it.
    if (alreadyRated !== undefined) {
        const known = { userId, movieId, title, observed: alreadyRated };
        renderPanel('user-panel', 'User-Based CF', known);
        renderPanel('item-panel', 'Item-Based CF', known);
        return;
    }

    // Both predictors run for the same pair, independently, so the two panels
    // are directly comparable even when one of them has to fall back.
    renderPanel('user-panel', 'User-Based CF', {
        userId, movieId, title, result: predictUserBased(userId, movieId), neighborNoun: 'users'
    });
    renderPanel('item-panel', 'Item-Based CF', {
        userId, movieId, title, result: predictItemBased(userId, movieId), neighborNoun: 'movies'
    });
}

function movieLabel(movieId) {
    const movie = movies.find(m => m.id === movieId);
    if (!movie) return `Movie ${movieId}`;
    return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

function ratingClass(value) {
    if (value >= 4) return 'high';
    if (value <= 2) return 'low';
    return 'medium';
}

// Fills one method's panel: the rating, plus the evidence behind it. A mean
// fallback is always labelled as such and carries the reason string from
// cf.js, so it is never mistaken for a similarity-based estimate.
function renderPanel(panelId, methodLabel, context) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    if (context.notice) {
        panel.className = 'panel';
        panel.innerHTML = `<h2>${methodLabel}</h2>`
            + `<p class="panel-note">${context.notice}</p>`;
        return;
    }

    const heading = `<h2>${methodLabel}</h2>`
        + `<p class="panel-pair">User ${context.userId} &middot; "${context.title}"</p>`;

    if (context.observed !== undefined) {
        panel.className = 'panel known';
        panel.innerHTML = heading
            + `<p class="panel-rating">${context.observed.toFixed(0)}<span class="out-of">/5</span></p>`
            + `<p class="panel-note observed">Observed rating &mdash; User ${context.userId} already `
            + `rated this movie, so no prediction was made. Pick a movie this user has not rated `
            + `to see the ${methodLabel} estimate.</p>`;
        return;
    }

    const result = context.result;
    if (!result || typeof result.rating !== 'number' || !isFinite(result.rating)) {
        panel.className = 'panel low';
        panel.innerHTML = heading
            + `<p class="panel-note">This method produced no usable rating for that pair.</p>`;
        return;
    }

    const evidence = result.fallback
        ? `<p class="panel-note">Mean fallback &mdash; ${result.fallbackReason}.</p>`
        : `<p class="panel-note">Based on ${result.neighbors} similar `
          + `${context.neighborNoun} with positive similarity.</p>`;

    panel.className = `panel ${ratingClass(result.rating)}`;
    panel.innerHTML = heading
        + `<p class="panel-rating">${result.rating.toFixed(2)}<span class="out-of">/5</span></p>`
        + evidence;
}


async function predictRating() {
    if (isTraining) {
        updateResult('Model is still training. Please wait...', 'medium');
        return;
    }
    
    const userId = parseInt(document.getElementById('user-select').value);
    const movieId = parseInt(document.getElementById('movie-select').value);
    
    if (!userId || !movieId) {
        updateResult('Please select both a user and a movie.', 'medium');
        return;
    }
    
    try {
        // Create input tensors
        const userTensor = tf.tensor2d([[userId]]);
        const movieTensor = tf.tensor2d([[movieId]]);
        
        // Make prediction
        const prediction = model.predict([userTensor, movieTensor]);
        const rating = await prediction.data();
        const predictedRating = rating[0];
        
        // Clean up tensors
        tf.dispose([userTensor, movieTensor, prediction]);
        
        // Display result
        const movie = movies.find(m => m.id === movieId);
        const movieTitle = movie ? (movie.year ? `${movie.title} (${movie.year})` : movie.title) : `Movie ${movieId}`;
        
        let ratingClass = 'medium';
        if (predictedRating >= 4) ratingClass = 'high';
        else if (predictedRating <= 2) ratingClass = 'low';
        
        updateResult(
            `Predicted rating for User ${userId} on "${movieTitle}": <strong>${predictedRating.toFixed(2)}/5</strong>`,
            ratingClass
        );
        
    } catch (error) {
        console.error('Prediction error:', error);
        updateResult('Error making prediction: ' + error.message, 'low');
    }
}

// UI helper functions
function updateStatus(message, isError = false) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.style.borderLeftColor = isError ? '#e74c3c' : '#3498db';
    statusElement.style.background = isError ? '#fdedec' : '#f8f9fa';
}

// Reached only from the retained MF code above. This page has no #result
// element, so the guard keeps a stray call from throwing a TypeError; the
// live UI is written by renderPanel() instead.
function updateResult(message, className = '') {
    const resultElement = document.getElementById('result');
    if (!resultElement) return;
    resultElement.innerHTML = message;
    resultElement.className = `result ${className}`;
}
